const http = require('http');

// Test all API endpoints
function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: 'localhost',
      port: 9680,
      path,
      method,
      headers: { 'Content-Type': 'application/json' }
    };
    const req = http.request(opts, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, headers: res.headers, body: JSON.parse(d) });
        } catch (e) {
          resolve({ status: res.statusCode, headers: res.headers, body: d.substring(0, 500) });
        }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function main() {
  let passed = 0;
  let failed = 0;

  function check(name, condition) {
    if (condition) {
      console.log(`  PASS: ${name}`);
      passed++;
    } else {
      console.log(`  FAIL: ${name}`);
      failed++;
    }
  }

  // 1. Health
  console.log('\n=== 1. GET /health ===');
  const h = await request('GET', '/health');
  check('status 200', h.status === 200);
  check('has status ok', h.body.status === 'ok');

  // 2. Models
  console.log('\n=== 2. GET /v1/models ===');
  const m = await request('GET', '/v1/models');
  check('status 200', m.status === 200);
  check('has data array', Array.isArray(m.body.data));
  check('has 3+ models', m.body.data.length >= 3);
  check('has qwork-auto', m.body.data.some(x => x.id === 'qwork-auto'));

  // 3. Model detail
  console.log('\n=== 3. GET /v1/models/qwork-auto ===');
  const md = await request('GET', '/v1/models/qwork-auto');
  check('status 200', md.status === 200);
  check('id matches', md.body.id === 'qwork-auto');

  // 4. Model not found
  console.log('\n=== 4. GET /v1/models/nonexistent ===');
  const mn = await request('GET', '/v1/models/nonexistent');
  check('status 404', mn.status === 404);

  // 5. Status
  console.log('\n=== 5. GET /status ===');
  const st = await request('GET', '/status');
  check('status 200', st.status === 200);
  check('has service', st.body.service !== undefined);

  // 6. Web console
  console.log('\n=== 6. GET / (web console) ===');
  const wc = await request('GET', '/');
  check('status 200', wc.status === 200);
  check('is HTML', typeof wc.body === 'string' && wc.body.includes('<!DOCTYPE'));

  // 7. Favicon
  console.log('\n=== 7. GET /favicon.svg ===');
  const fv = await request('GET', '/favicon.svg');
  check('status 200', fv.status === 200);

  // 8. Logs (empty)
  console.log('\n=== 8. GET /api/logs ===');
  const lg = await request('GET', '/api/logs');
  check('status 200', lg.status === 200);
  check('has items array', Array.isArray(lg.body.items));

  // 9. Chat completions - invalid request
  console.log('\n=== 9. POST /v1/chat/completions (missing messages) ===');
  const ci = await request('POST', '/v1/chat/completions', { model: 'qwork-auto' });
  check('status 400', ci.status === 400);

  // 10. Chat completions - valid request (non-streaming, will return empty if not logged in)
  console.log('\n=== 10. POST /v1/chat/completions (valid, non-streaming) ===');
  try {
    const cv = await request('POST', '/v1/chat/completions', {
      model: 'qwork-auto',
      messages: [{ role: 'user', content: 'Hi' }],
      stream: false
    });
    check('status 200', cv.status === 200);
    check('has id', cv.body.id !== undefined);
    check('has choices', Array.isArray(cv.body.choices));
    check('has model', cv.body.model === 'qwork-auto');
  } catch (e) {
    check('request completed', false);
    console.log('  Error:', e.message);
  }

  // 11. Check logs after chat
  console.log('\n=== 11. GET /api/logs (after chat) ===');
  const lg2 = await request('GET', '/api/logs');
  check('status 200', lg2.status === 200);
  check('has log entry', lg2.body.total > 0);

  // 12. Get specific log
  if (lg2.body.items.length > 0) {
    console.log('\n=== 12. GET /api/logs/:id ===');
    const logId = lg2.body.items[0].id;
    const lg3 = await request('GET', `/api/logs/${logId}`);
    check('status 200', lg3.status === 200);
    check('has request data', lg3.body.request !== undefined);
    check('has response data', lg3.body.response !== undefined);
    check('has sdkMessages', Array.isArray(lg3.body.sdkMessages));
  }

  // Summary
  console.log(`\n========================================`);
  console.log(`Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
  console.log(`========================================`);
}

main().catch(console.error);
