const fs = require('fs');
try {
    const content = fs.readFileSync('server.log', 'utf16le');
    console.log(content);
} catch (e) {
    try {
        const content = fs.readFileSync('server.log', 'utf8');
        console.log(content);
    } catch (e2) {
        console.error('Failed to read log:', e2);
    }
}
