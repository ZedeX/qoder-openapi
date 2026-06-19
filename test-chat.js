const http = require('http');

const data = JSON.stringify({
  model: 'qmodel_latest',
  messages: [{ role: 'user', content: 'Say hello in one sentence.' }],
  stream: false,
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

console.log('Sending non-streaming request...');
const startTime = Date.now();

const req = http.request(options, (res) => {
  let body = '';
  res.on('data', (chunk) => { body += chunk; });
  res.on('end', () => {
    const elapsed = Date.now() - startTime;
    console.log(`Response received in ${elapsed}ms`);
    console.log('Status:', res.statusCode);
    try {
      const parsed = JSON.parse(body);
      console.log('Content:', parsed.choices?.[0]?.message?.content || '(empty)');
      console.log('Usage:', parsed.usage);
    } catch (e) {
      console.log('Raw response:', body.substring(0, 500));
    }
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
