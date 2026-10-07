export async function onRequestPost(context) {
    const { request, env } = context;

    try {
        // Check for API key
        const apiKey = env.OPENAI_API_KEY || env.VITE_OPENAI_API_KEY;

        if (!apiKey) {
            return new Response(JSON.stringify({ error: "Missing API Key on Server" }), {
                status: 500,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        // Get the form data from the request
        const formData = await request.formData();
        const audioFile = formData.get('file');

        if (!audioFile) {
            return new Response(JSON.stringify({ error: "No file uploaded" }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        // Whisper rejects files over 25MB — fail fast with a clear error instead
        // of forwarding a doomed upload.
        if (audioFile.size > 25 * 1024 * 1024) {
            return new Response(JSON.stringify({ error: "Audio exceeds Whisper's 25MB limit. Record shorter sessions or chunk the upload." }), {
                status: 413,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        // Construct new FormData for OpenAI
        const openAIFormData = new FormData();
        openAIFormData.append('file', audioFile, 'audio.webm');
        openAIFormData.append('model', 'whisper-1');
        openAIFormData.append('response_format', 'verbose_json');
        openAIFormData.append('timestamp_granularities[]', 'segment');

        // Call OpenAI API
        const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`
            },
            body: openAIFormData
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error(`❌ OpenAI API Error: ${response.status} - ${errorText}`);
            return new Response(JSON.stringify({ error: `OpenAI Error: ${response.status}`, details: errorText }), {
                status: response.status,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        const data = await response.json();

        return new Response(JSON.stringify(data), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });

    } catch (error) {
        return new Response(JSON.stringify({ error: error.message }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}
