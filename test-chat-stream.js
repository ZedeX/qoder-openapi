const http = require('http');

const data = JSON.stringify({
  model: 'qmodel_latest',
  messages: [{ role: 'user', content: 'Say hello in one sentence.' }],
  stream: true,
});

const options = {
  hostname: 'localhost',
  port: 9680,
  path: '/v1/chat/completions',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': data.length,
  },
  timeout: 30000,
};

console.log('Sending streaming request...');
const startTime = Date.now();
let chunkCount = 0;
let fullContent = '';

const req = http.request(options, (res) => {
  console.log('Status:', res.statusCode);
  let buffer = '';
  res.on('data', (chunk) => {
    buffer += chunk.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop(); // keep incomplete line
    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const jsonStr = line.slice(6).trim();
        if (jsonStr === '[DONE]') {
          console.log('\nStream completed');
          continue;
        }
        try {
          const parsed = JSON.parse(jsonStr);
          const delta = parsed.choices?.[0]?.delta;
          if (delta?.content) {
            process.stdout.write(delta.content);
            fullContent += delta.content;
            chunkCount++;
          }
        } catch (e) {
          // skip non-JSON lines
        }
      }
    }
  });
  res.on('end', () => {
    const elapsed = Date.now() - startTime;
    console.log(`\nTotal time: ${elapsed}ms, chunks: ${chunkCount}`);
    console.log('Full content:', fullContent || '(empty)');
    process.exit(0);
  });
});

req.on('error', (e) => {
  console.error('Request error:', e.message);
  process.exit(1);
});

req.on('timeout', () => {
  console.error('Request timed out');
  req.destroy();
  process.exit(1);
});

req.write(data);
req.end();
