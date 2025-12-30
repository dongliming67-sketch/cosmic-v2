require('dotenv').config();

async function testSimple() {
    const apiKey = process.env.GEMINI_API_KEY;
    const modelName = process.env.GEMINI_MODEL || 'gemini-2.0-flash';

    console.log(`Testing ${modelName} with key ending in ...${apiKey.slice(-4)}`);

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;

    const payload = {
        contents: [{
            parts: [{ text: "Hello!" }]
        }]
    };

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            console.log(`Status: ${response.status} ${response.statusText}`);
            const text = await response.text();
            console.log('Response:', text);
        } else {
            const data = await response.json();
            console.log('Success!');
            console.log('Response text:', data.candidates?.[0]?.content?.parts?.[0]?.text);
        }
    } catch (err) {
        console.error('Error:', err);
    }
}

testSimple();
