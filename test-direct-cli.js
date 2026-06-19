// Test: direct CLI transport via the gateway API
const http = require('http');

function makeRequest(options, body) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        resolve({ statusCode: res.statusCode, headers: res.headers, body: data });
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function testStatus() {
  console.log('=== Test: /status endpoint ===');
  const res = await makeRequest({
    hostname: 'localhost',
    port: 9680,
    path: '/status',
    method: 'GET',
  });
  const data = JSON.parse(res.body);
  console.log('Login status:', JSON.stringify(data.login, null, 2));
  console.log('Transport:', JSON.stringify(data.transport, null, 2));
  console.log('');
}

async function testNonStreaming() {
  console.log('=== Test: Non-streaming chat completion ===');
  const requestBody = JSON.stringify({
    model: 'qmodel_latest',
    messages: [{ role: 'user', content: 'Say hello in Chinese, one sentence only' }],
    stream: false,
    max_turns: 1,
  });

  const res = await makeRequest({
    hostname: 'localhost',
    port: 9680,
    path: '/v1/chat/completions',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  }, requestBody);

  console.log('Status:', res.statusCode);
  if (res.statusCode === 200) {
    const data = JSON.parse(res.body);
    console.log('Content:', data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content);
    console.log('Usage:', JSON.stringify(data.usage));
  } else {
    console.log('Error:', res.body.substring(0, 500));
  }
  console.log('');
}

async function testStreaming() {
  console.log('=== Test: Streaming chat completion ===');
  const requestBody = JSON.stringify({
    model: 'qmodel_latest',
    messages: [{ role: 'user', content: 'What is 2+2? Answer briefly.' }],
    stream: true,
    max_turns: 1,
  });

  const res = await new Promise((resolve, reject) => {
    const req = http.request({
      hostname: 'localhost',
      port: 9680,
      path: '/v1/chat/completions',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        resolve({ statusCode: res.statusCode, body: data });
      });
    });
    req.on('error', reject);
    req.write(requestBody);
    req.end();
  });

  console.log('Status:', res.statusCode);
  if (res.statusCode === 200) {
    // Parse SSE data
    const lines = res.body.split('\n');
    let fullContent = '';
    for (const line of lines) {
      if (line.startsWith('data: ') && line !== 'data: [DONE]') {
        try {
          const chunk = JSON.parse(line.substring(6));
          if (chunk.choices && chunk.choices[0] && chunk.choices[0].delta && chunk.choices[0].delta.content) {
            fullContent += chunk.choices[0].delta.content;
          }
        } catch {}
      }
    }
    console.log('Streamed content:', fullContent);
  } else {
    console.log('Error:', res.body.substring(0, 500));
  }
}

async function main() {
  try {
    await testStatus();
    await testNonStreaming();
    await testStreaming();
  } catch (err) {
    console.error('Test error:', err.message);
  }
}

main();
