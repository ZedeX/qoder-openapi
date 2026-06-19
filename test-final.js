const http = require('http');
const data = JSON.stringify({
  model: 'qmodel_latest',
  messages: [{ role: 'user', content: 'Say hello in Chinese, just one sentence' }],
  stream: false
});
const req = http.request({
  hostname: 'localhost', port: 9680,
  path: '/v1/chat/completions', method: 'POST',
  headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
}, res => {
  let d = '';
  res.on('data', c => d += c);
  res.on('end', () => {
    try {
      const j = JSON.parse(d);
      console.log('Status:', res.statusCode);
      console.log('Model:', j.model);
      console.log('Content:', j.choices?.[0]?.message?.content || '(empty)');
      console.log('Finish Reason:', j.choices?.[0]?.finish_reason);
      console.log('Usage:', JSON.stringify(j.usage));
    } catch (e) { console.log('Raw:', d.substring(0, 1000)); }
  });
});
req.write(data);
req.end();
