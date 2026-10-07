// import 'dotenv/config';
import fs from 'fs';
import path from 'path';

// Manually load .env if dotenv doesn't work automatically
const envPath = path.resolve(process.cwd(), '.env');
if (fs.existsSync(envPath)) {
    const envConfig = fs.readFileSync(envPath, 'utf-8');
    envConfig.split('\n').forEach(line => {
        const [key, value] = line.split('=');
        if (key && value) {
            process.env[key.trim()] = value.trim();
        }
    });
}

const apiKey = process.env.VITE_OPENAI_API_KEY || process.env.OPENAI_API_KEY;

if (!apiKey) {
    console.error("❌ No API Key found in environment!");
    process.exit(1);
}

console.log(`🔑 Found API Key: ${apiKey.substring(0, 10)}...`);

async function testKey() {
    try {
        console.log("📡 Testing API Key with OpenAI...");
        const response = await fetch('https://api.openai.com/v1/models', {
            headers: {
                'Authorization': `Bearer ${apiKey}`
            }
        });

        if (response.ok) {
            console.log("✅ API Key is VALID! Successfully connected to OpenAI.");
        } else {
            console.error(`❌ API Key Invalid or Error: ${response.status} ${response.statusText}`);
            const text = await response.text();
            console.error("Response:", text);
        }
    } catch (error) {
        console.error("❌ Network Error:", error.message);
    }
}

testKey();
