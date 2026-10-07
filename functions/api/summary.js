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

        // Check for API key in multiple possible env vars
        const apiKey = env.OPENAI_API_KEY || env.VITE_OPENAI_API_KEY;

        if (!apiKey) {
            return new Response(JSON.stringify({ error: "Missing API Key on Server. Please add OPENAI_API_KEY to Cloudflare Pages settings." }), {
                status: 500,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        // Only forward a validated, size-capped chat payload — this endpoint is
        // publicly reachable, so it must not act as an open proxy to OpenAI.
        const ALLOWED_MODELS = ['gpt-4o', 'gpt-4o-mini', 'gpt-3.5-turbo'];
        if (!Array.isArray(body.messages) || body.messages.length === 0 || body.messages.length > 8 ||
            !body.messages.every(m => m && ['system', 'user', 'assistant'].includes(m.role) && typeof m.content === 'string')) {
            return new Response(JSON.stringify({ error: "Invalid messages payload" }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' }
            });
        }
        const totalChars = body.messages.reduce((n, m) => n + m.content.length, 0);
        if (totalChars > 120000) {
            return new Response(JSON.stringify({ error: "Transcript too long" }), {
                status: 413,
                headers: { 'Content-Type': 'application/json' }
            });
        }
        const payload = {
            model: ALLOWED_MODELS.includes(body.model) ? body.model : 'gpt-4o',
            messages: body.messages,
            temperature: Math.min(Math.max(Number(body.temperature) || 0.7, 0), 2)
        };

        const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify(payload)
        });

        let data;
        try {
            data = await response.json();
        } catch (e) {
            return new Response(JSON.stringify({ error: `Upstream returned non-JSON response (status ${response.status})` }), {
                status: 502,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        // If OpenAI returns an error, forward it with the correct status
        if (!response.ok) {
            return new Response(JSON.stringify(data), {
                status: response.status,
                headers: { 'Content-Type': 'application/json' }
            });
        }

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
