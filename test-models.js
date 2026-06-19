const { spawn } = require('child_process');

const models = ['qwork-auto', 'qwork-ultimate', 'qmodel_latest', 'safety'];
let completed = 0;

for (const model of models) {
  const child = spawn('d:\\_program\\QoderWork\\resources\\bin\\qodercli.exe', [
    '--model', model,
    '--max-turns', '1',
    '--output-format', 'stream-json',
    'prompt', 'hi'
  ], { cwd: process.cwd(), env: { ...process.env }, stdio: ['pipe', 'pipe', 'pipe'] });

  let stdout = '';
  child.stdout.on('data', d => stdout += d.toString());
  child.stderr.on('data', d => {});
  child.on('close', code => {
    // Extract the assistant message
    const lines = stdout.split('\n').filter(l => l.trim());
    for (const line of lines) {
      try {
        const msg = JSON.parse(line);
        if (msg.type === 'assistant' && msg.message?.content) {
          const text = msg.message.content.find(c => c.type === 'text');
          if (text) {
            console.log(`Model ${model}: ${text.text.substring(0, 200)}`);
          }
        }
        if (msg.type === 'result') {
          console.log(`  Duration: ${msg.duration_ms}ms, Error: ${msg.is_error}`);
        }
      } catch (e) {}
    }
    completed++;
    if (completed === models.length) process.exit(0);
  });
}

setTimeout(() => process.exit(1), 60000);
