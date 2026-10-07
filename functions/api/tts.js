export async function onRequestPost(context) {
    const { request, env } = context;

    try {
        // Get the request body
        let body;
        try {
            body = await request.json();
        } catch (e) {
            return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        // Check for API key
        const apiKey = env.ELEVENLABS_API_KEY || env.VITE_ELEVENLABS_API_KEY;
        const voiceId = 'EXAVITQu4vr4xnSDxMaL'; // Bella

        if (!apiKey) {
            return new Response(JSON.stringify({ error: "Missing ElevenLabs API Key on Server. Please add ELEVENLABS_API_KEY to Cloudflare Pages settings." }), {
                status: 500,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        // Publicly reachable endpoint: only forward a validated, size-capped payload.
        if (typeof body.text !== 'string' || body.text.length === 0) {
            return new Response(JSON.stringify({ error: "Missing text" }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' }
            });
        }
        if (body.text.length > 2000) {
            return new Response(JSON.stringify({ error: "Text too long" }), {
                status: 413,
                headers: { 'Content-Type': 'application/json' }
            });
        }
        const payload = {
            text: body.text,
            model_id: typeof body.model_id === 'string' ? body.model_id : 'eleven_monolingual_v1',
            voice_settings: body.voice_settings
        };

        const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
            method: 'POST',
            headers: {
                'Accept': 'audio/mpeg',
                'Content-Type': 'application/json',
                'xi-api-key': apiKey
            },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const errorText = await response.text();
            return new Response(JSON.stringify({ error: `ElevenLabs API Error: ${response.status}`, details: errorText }), {
                status: response.status,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        // Return the audio blob directly
        const audioBlob = await response.blob();

        return new Response(audioBlob, {
            status: 200,
            headers: {
                'Content-Type': 'audio/mpeg',
                'Content-Length': audioBlob.size.toString()
            }
        });

    } catch (error) {
        return new Response(JSON.stringify({ error: error.message }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}
