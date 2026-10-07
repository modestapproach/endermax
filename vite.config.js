import { defineConfig, loadEnv } from 'vite';
import { resolve } from 'path';

export default defineConfig(({ mode }) => {
    // Load env file based on `mode` in the current working directory.
    // Set the third parameter to '' to load all env regardless of the `VITE_` prefix.
    const env = loadEnv(mode, process.cwd(), '');

    if (!env.VITE_OPENAI_API_KEY) {
        console.warn("⚠️  VITE_OPENAI_API_KEY not found in .env — dev /api proxies will fail auth.");
    }

    return {
        assetsInclude: ['**/*.glb'],
        build: {
            rollupOptions: {
                input: {
                    main: resolve(__dirname, 'index.html'),
                    results: resolve(__dirname, 'results.html'),
                    portfolio: resolve(__dirname, 'portfolio.html')
                },
                output: {
                    // Keep the heavyweights in named shared chunks: three.js is
                    // used by both pages, face-api only after camera opt-in.
                    manualChunks: {
                        three: ['three'],
                        'face-api': ['face-api.js']
                    }
                }
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
