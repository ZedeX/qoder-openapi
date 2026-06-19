/**
 * Test script for QoderWork API Gateway
 *
 * Usage: node test-gateway.js
 *
 * This script tests all gateway endpoints.
 * Make sure QoderWork is running and you are logged in before testing chat completions.
 */

const http = require('http');

const BASE_URL = 'http://localhost:9680';

function makeRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method: method,
      headers: {
        'Content-Type': 'application/json',
      },
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, data: data });
        }
      });
    });

    req.on('error', reject);

    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

async function testSSE(path, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => resolve(data));
    });

    req.on('error', reject);
    req.write(JSON.stringify(body));
    req.end();
  });
}

async function main() {
  console.log('=== QoderWork API Gateway Test ===\n');

  // Test 1: Health check
  console.log('1. Testing /health...');
  try {
    const health = await makeRequest('GET', '/health');
    console.log('   Status:', health.status);
    console.log('   Response:', JSON.stringify(health.data, null, 2));
  } catch (err) {
    console.log('   FAILED:', err.message);
  }
  console.log();

  // Test 2: Status check
  console.log('2. Testing /status...');
  try {
    const status = await makeRequest('GET', '/status');
    console.log('   Status:', status.status);
    console.log('   Login:', status.data.login);
    console.log('   Models:', status.data.models);
  } catch (err) {
    console.log('   FAILED:', err.message);
  }
  console.log();

  // Test 3: Models list
  console.log('3. Testing /v1/models...');
  try {
    const models = await makeRequest('GET', '/v1/models');
    console.log('   Status:', models.status);
    console.log('   Models:', models.data.data.map(m => m.id));
  } catch (err) {
    console.log('   FAILED:', err.message);
  }
  console.log();

  // Test 4: Model info
  console.log('4. Testing /v1/models/qwork-auto...');
  try {
    const modelInfo = await makeRequest('GET', '/v1/models/qwork-auto');
    console.log('   Status:', modelInfo.status);
    console.log('   Model:', modelInfo.data.id, '- owned_by:', modelInfo.data.owned_by);
  } catch (err) {
    console.log('   FAILED:', err.message);
  }
  console.log();

  // Test 5: Chat completion (non-streaming)
  console.log('5. Testing /v1/chat/completions (non-streaming)...');
  try {
    const completion = await makeRequest('POST', '/v1/chat/completions', {
      model: 'qwork-auto',
      messages: [{ role: 'user', content: 'Say hello in one sentence.' }],
      stream: false,
    });
    console.log('   Status:', completion.status);
    if (completion.data.choices) {
      console.log('   Content:', completion.data.choices[0].message.content.substring(0, 200));
      console.log('   Usage:', completion.data.usage);
    } else {
      console.log('   Response:', JSON.stringify(completion.data).substring(0, 300));
    }
  } catch (err) {
    console.log('   FAILED:', err.message);
  }
  console.log();

  // Test 6: Chat completion (streaming)
  console.log('6. Testing /v1/chat/completions (streaming)...');
  try {
    const sseData = await testSSE('/v1/chat/completions', {
      model: 'qwork-auto',
      messages: [{ role: 'user', content: 'Say hello in one sentence.' }],
      stream: true,
    });
    // Parse SSE data
    const lines = sseData.split('\n').filter(l => l.startsWith('data: '));
    console.log('   SSE events received:', lines.length);
    let fullContent = '';
    for (const line of lines) {
      const data = line.substring(6);
      if (data === '[DONE]') continue;
      try {
        const parsed = JSON.parse(data);
        if (parsed.choices && parsed.choices[0] && parsed.choices[0].delta && parsed.choices[0].delta.content) {
          fullContent += parsed.choices[0].delta.content;
        }
      } catch {}
    }
    console.log('   Streamed content:', fullContent.substring(0, 200));
  } catch (err) {
    console.log('   FAILED:', err.message);
  }
  console.log();

  console.log('=== Tests Complete ===');
}

main().catch(console.error);
