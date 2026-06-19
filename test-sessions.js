const http = require('http');

function req(method, path, body) {
  return new Promise((resolve, reject) => {
    const opts = { hostname: 'localhost', port: 9680, path, method, headers: { 'Content-Type': 'application/json' } };
    const r = http.request(opts, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve({ s: res.statusCode, b: JSON.parse(d) }); } catch (e) { resolve({ s: res.statusCode, b: d.substring(0, 300) }); } });
    });
    r.on('error', reject);
    if (body) r.write(JSON.stringify(body));
    r.end();
  });
}

async function main() {
  let passed = 0, failed = 0;
  function check(name, cond) { if (cond) { console.log('  PASS:', name); passed++; } else { console.log('  FAIL:', name); failed++; } }

  console.log('=== 1. List sessions (empty) ===');
  const l = await req('GET', '/api/sessions');
  check('status 200', l.s === 200);
  check('has sessions array', Array.isArray(l.b.sessions));

  console.log('=== 2. Create session ===');
  const c = await req('POST', '/api/sessions', { model: 'qmodel_latest' });
  check('status 201', c.s === 201);
  check('has id', !!c.b.id);
  check('title is New Chat', c.b.title === 'New Chat');
  const sid = c.b.id;

  console.log('=== 3. Add user message ===');
  const m1 = await req('POST', '/api/sessions/' + sid + '/messages', { role: 'user', content: 'Hello!' });
  check('status 200', m1.s === 200);
  check('auto-titled', m1.b.title === 'Hello!');
  check('1 message', m1.b.messages.length === 1);

  console.log('=== 4. Add assistant message ===');
  const m2 = await req('POST', '/api/sessions/' + sid + '/messages', { role: 'assistant', content: 'Hi there!' });
  check('status 200', m2.s === 200);
  check('2 messages', m2.b.messages.length === 2);

  console.log('=== 5. Get session ===');
  const g = await req('GET', '/api/sessions/' + sid);
  check('status 200', g.s === 200);
  check('2 messages', g.b.messages.length === 2);
  check('first msg content', g.b.messages[0].content === 'Hello!');

  console.log('=== 6. Rename session ===');
  const rn = await req('PATCH', '/api/sessions/' + sid, { title: 'Test Chat' });
  check('status 200', rn.s === 200);
  check('title updated', rn.b.title === 'Test Chat');

  console.log('=== 7. List sessions ===');
  const l2 = await req('GET', '/api/sessions');
  check('status 200', l2.s === 200);
  check('1 session', l2.b.sessions.length === 1);
  check('title matches', l2.b.sessions[0].title === 'Test Chat');

  console.log('=== 8. Create second session ===');
  const c2 = await req('POST', '/api/sessions', { model: 'qmodel_latest' });
  check('status 201', c2.s === 201);
  const sid2 = c2.b.id;

  console.log('=== 9. List sessions (2) ===');
  const l3 = await req('GET', '/api/sessions');
  check('2 sessions', l3.b.sessions.length === 2);

  console.log('=== 10. Delete first session ===');
  const d = await req('DELETE', '/api/sessions/' + sid);
  check('status 200', d.s === 200);

  console.log('=== 11. List after delete ===');
  const l4 = await req('GET', '/api/sessions');
  check('1 session left', l4.b.sessions.length === 1);
  check('remaining is sid2', l4.b.sessions[0].id === sid2);

  console.log('=== 12. Delete non-existent ===');
  const dn = await req('DELETE', '/api/sessions/nonexistent');
  check('status 404', dn.s === 404);

  // Cleanup
  await req('DELETE', '/api/sessions/' + sid2);

  console.log('\n========================================');
  console.log('Results: ' + passed + ' passed, ' + failed + ' failed');
  console.log('========================================');
}

main().catch(console.error);
