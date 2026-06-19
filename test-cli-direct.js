// Test: spawn qodercli.exe directly and interact via stdin/stdout
const { spawn } = require('child_process');

const cliPath = 'd:\\_program\\QoderWork\\resources\\bin\\qodercli.exe';

// First test: just run qodercli with a prompt directly
console.log('=== Test: qodercli.exe direct query ===');

const args = [
  '--model', 'qwork-auto',
  '--max-turns', '1',
  '--output-format', 'stream-json',
  'prompt', 'Say hello in Chinese, one sentence only'
];

console.log('Command:', cliPath, args.join(' '));

const child = spawn(cliPath, args, {
  cwd: process.cwd(),
  env: { ...process.env },
  stdio: ['pipe', 'pipe', 'pipe']
});

let stdout = '';
let stderr = '';

child.stdout.on('data', (data) => {
  const chunk = data.toString();
  stdout += chunk;
  console.log('STDOUT:', chunk.substring(0, 500));
});

child.stderr.on('data', (data) => {
  const chunk = data.toString();
  stderr += chunk;
  console.log('STDERR:', chunk.substring(0, 300));
});

child.on('close', (code) => {
  console.log('\nExit code:', code);
  console.log('Total stdout length:', stdout.length);
  console.log('Total stderr length:', stderr.length);
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

// Timeout after 30s
setTimeout(() => {
  console.log('Timeout, killing process...');
  child.kill();
}, 30000);
