// Debug: capture raw qodercli output to understand message format
const { spawn } = require('child_process');
const fs = require('fs');

const cliPath = 'd:\\_program\\QoderWork\\resources\\bin\\qodercli.exe';
const args = [
  '--model', 'qmodel_latest',
  '--max-turns', '3',
  '--permission-mode', 'bypassPermissions',
  '--output-format', 'stream-json',
  'prompt', 'List the files in the current directory using the list_files tool'
];

const child = spawn(cliPath, args, {
  cwd: 'd:\\_program\\QoderWork',
  env: { ...process.env },
  stdio: ['pipe', 'pipe', 'pipe'],
  windowsHide: true,
});

let allOutput = '';

child.stdout.on('data', (data) => {
  const raw = data.toString();
  allOutput += raw;

  // Parse and log each line
  const lines = raw.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const msg = JSON.parse(trimmed);
      console.log(`[${msg.type}] ${msg.subtype || ''} | content types: ${msg.message?.content?.map(c => c.type).join(',') || 'N/A'} | text preview: ${(msg.message?.content?.find(c => c.type === 'text')?.text || '').substring(0, 100)}`);
      if (msg.type === 'assistant' && msg.message?.content) {
        for (const block of msg.message.content) {
          if (block.type === 'tool_use') {
            console.log(`  TOOL_USE: id=${block.id} name=${block.name} input=${JSON.stringify(block.input).substring(0, 200)}`);
          }
          if (block.type === 'text') {
            console.log(`  TEXT: ${block.text.substring(0, 200)}`);
          }
          if (block.type === 'tool_result') {
            console.log(`  TOOL_RESULT: id=${block.tool_use_id} content=${JSON.stringify(block.content).substring(0, 200)}`);
          }
        }
      }
      if (msg.type === 'tool_result') {
        console.log(`  TOOL_RESULT_MSG: ${JSON.stringify(msg).substring(0, 300)}`);
      }
    } catch (e) {
      console.log(`PARSE_ERROR: ${trimmed.substring(0, 100)}`);
    }
  }
});

child.stderr.on('data', (data) => {
  console.log('STDERR:', data.toString().substring(0, 200));
});

child.on('close', (code) => {
  console.log('\nExit code:', code);
  // Save raw output for analysis
  fs.writeFileSync('d:\\_program\\QoderWork\\qoder-openapi\\debug-output.txt', allOutput, 'utf-8');
  console.log('Raw output saved to debug-output.txt');
});

setTimeout(() => {
  console.log('Timeout, killing...');
  child.kill();
}, 60000);
