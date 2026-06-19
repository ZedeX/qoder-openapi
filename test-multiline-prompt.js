// Test: spawn qodercli with multi-line prompt (same as server uses)
const { spawn } = require('child_process');

const cliPath = 'd:\\_program\\QoderWork\\resources\\bin\\qodercli.exe';

// This is the exact format the server uses
const prompt = '[User]\nSay hello in Chinese, one sentence only';

const args = [
  '--model', 'qmodel_latest',
  '--max-turns', '1',
  '--output-format', 'stream-json',
  'prompt', prompt,
];

console.log('Args:', JSON.stringify(args));

const child = spawn(cliPath, args, {
  cwd: process.cwd(),
  env: { ...process.env },
  stdio: ['pipe', 'pipe', 'pipe'],
  windowsHide: true,
});

let stdout = '';
let stderr = '';

child.stdout.on('data', (data) => {
  const chunk = data.toString();
  stdout += chunk;
  console.log('STDOUT chunk:', chunk.substring(0, 300));
});

child.stderr.on('data', (data) => {
  stderr += data.toString();
  console.log('STDERR:', data.toString().substring(0, 300));
});

child.on('close', (code) => {
  console.log('\nExit code:', code);
  console.log('Total stdout length:', stdout.length);
  if (stdout.length > 0) {
    console.log('Full stdout:', stdout.substring(0, 2000));
  }
  if (stderr.length > 0) {
    console.log('Full stderr:', stderr.substring(0, 2000));
  }
});

child.on('error', (err) => {
  console.error('Spawn error:', err.message);
});

setTimeout(() => {
  console.log('Timeout, killing process...');
  child.kill();
  process.exit(0);
}, 60000);
