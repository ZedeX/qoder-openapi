// Test streaming with tool_use visibility
const http = require('http');

const data = JSON.stringify({
  model: 'qmodel_latest',
  messages: [{ role: 'user', content: 'List the files in the current directory' }],
  stream: true,
  max_turns: 3,
});

const req = http.request({
  hostname: 'localhost', port: 9680,
  path: '/v1/chat/completions', method: 'POST',
  headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
}, res => {
  let buffer = '';
  res.on('data', chunk => {
    buffer += chunk.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith('data: ')) continue;
      const payload = trimmed.slice(6);
      if (payload === '[DONE]') { console.log('\n[DONE]'); return; }
      try {
        const obj = JSON.parse(payload);
        const delta = obj.choices?.[0]?.delta;
        const qtype = obj._qoder_type || '';
        if (qtype) {
          if (qtype === 'thinking') {
            console.log('[THINKING]', (delta?.thinking || delta?.content || '').substring(0, 100));
          } else if (qtype === 'tool_use') {
            console.log('[TOOL_USE]', obj._qoder_tool_name, JSON.stringify(obj._qoder_tool_input).substring(0, 150));
          } else if (qtype === 'tool_result') {
            console.log('[TOOL_RESULT]', obj._qoder_tool_id, (delta?.content || '').substring(0, 100));
          } else {
            console.log('[' + qtype + ']', JSON.stringify(delta).substring(0, 150));
          }
        } else if (delta?.content) {
          process.stdout.write(delta.content);
        }
        if (obj.choices?.[0]?.finish_reason) {
          console.log('\n[FINISH]', obj.choices[0].finish_reason);
        }
      } catch {}
    }
  });
  res.on('end', () => { console.log('\nStream ended.'); });
});
req.write(data);
req.end();
