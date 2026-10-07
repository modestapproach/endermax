import { defineConfig, loadEnv } from 'vite';
import { resolve } from 'path';
import { mkdirSync, writeFileSync } from 'fs';

// Dev-only: window.endermax.shot()/plan() POST a data URL here and it lands in
// .shots/<name>.png, so screenshots of the live sim are real files that
// humans, agents, and visual-review passes can open.
function shotsPlugin() {
    return {
        name: 'endermax-shots',
        configureServer(server) {
            server.middlewares.use('/__shot', (req, res) => {
                if (req.method !== 'POST') { res.statusCode = 405; return res.end(); }
                const name = (new URL(req.url, 'http://x').searchParams.get('name') || 'shot').replace(/[^\w.-]/g, '_');
                let body = '';
                req.on('data', (c) => { body += c; });
                req.on('end', () => {
                    const m = body.match(/^data:image\/(png|jpeg);base64,(.*)$/);
                    if (!m) { res.statusCode = 400; return res.end('expected an image data URL'); }
                    const dir = resolve(__dirname, '.shots');
                    mkdirSync(dir, { recursive: true });
                    const file = resolve(dir, `${name}.${m[1] === 'jpeg' ? 'jpg' : 'png'}`);
                    writeFileSync(file, Buffer.from(m[2], 'base64'));
                    res.setHeader('Content-Type', 'application/json');
                    res.end(JSON.stringify({ path: file }));
                });
            });
        }
    };
}

export default defineConfig(({ mode }) => {
    // Load env file based on `mode` in the current working directory.
    // Set the third parameter to '' to load all env regardless of the `VITE_` prefix.
    const env = loadEnv(mode, process.cwd(), '');

    if (!env.VITE_OPENAI_API_KEY) {
        console.warn("⚠️  VITE_OPENAI_API_KEY not found in .env — dev /api proxies will fail auth.");
    }

    return {
        plugins: [shotsPlugin()],
        assetsInclude: ['**/*.glb'],
        build: {
            rollupOptions: {
                input: {
                    main: resolve(__dirname, 'index.html'),
                    results: resolve(__dirname, 'results.html'),
                    portfolio: resolve(__dirname, 'portfolio.html')
                },
            }
        },
        server: {
            host: '127.0.0.1',
            proxy: {
                '/api/summary': {
                    target: 'https://api.openai.com/v1/chat/completions',
                    changeOrigin: true,
                    rewrite: (path) => path.replace(/^\/api\/summary/, ''),
                    configure: (proxy, options) => {
                        proxy.on('proxyReq', (proxyReq, req, res) => {
                            // Inject API Key from local .env
                            proxyReq.setHeader('Authorization', `Bearer ${env.VITE_OPENAI_API_KEY}`);
                        });
                    }
                },
                '/api/transcribe': {
                    target: 'https://api.openai.com/v1/audio/transcriptions',
                    changeOrigin: true,
                    rewrite: (path) => '',
                    configure: (proxy, options) => {
                        proxy.on('proxyReq', (proxyReq, req, res) => {
                            proxyReq.setHeader('Authorization', `Bearer ${env.VITE_OPENAI_API_KEY}`);
                        });
                    }
                },
                '/api/tts': {
                    target: 'https://api.elevenlabs.io/v1/text-to-speech/EXAVITQu4vr4xnSDxMaL',
                    changeOrigin: true,
                    rewrite: (path) => path.replace(/^\/api\/tts/, ''),
                    configure: (proxy, options) => {
                        proxy.on('proxyReq', (proxyReq, req, res) => {
                            // Inject API Key from local .env
                            proxyReq.setHeader('xi-api-key', env.VITE_ELEVENLABS_API_KEY);
                        });
                    }
                }
            }
        }
    };
});
