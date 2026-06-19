// Debug: test queryViaDirectCLI function directly
const { spawn } = require('child_process');

const cliPath = 'd:\\_program\\QoderWork\\resources\\bin\\qodercli.exe';
const prompt = 'Say hello';
const model = 'qmodel_latest';
const maxTurns = 1;

const args = [
  '--model', model,
  '--max-turns', String(maxTurns),
  '--output-format', 'stream-json',
  'prompt', prompt,
];

console.log('Spawning:', cliPath, args.join(' '));

const child = spawn(cliPath, args, {
  cwd: process.cwd(),
  env: { ...process.env },
  stdio: ['pipe', 'pipe', 'pipe'],
  windowsHide: true,
});

let lineBuffer = '';
const lineQueue = [];
let lineResolve = null;
let streamEnded = false;
let streamError = null;

child.stdout.on('data', (data) => {
  lineBuffer += data.toString();
  const lines = lineBuffer.split('\n');
  lineBuffer = lines.pop() || '';
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed) {
      lineQueue.push(trimmed);
      if (lineResolve) {
        lineResolve();
        lineResolve = null;
      }
    }
  }
});

child.stderr.on('data', (data) => {
  console.log('STDERR:', data.toString().trim().substring(0, 500));
});

child.on('close', (code) => {
  console.log('Process exited with code:', code);
  if (lineBuffer.trim()) {
    lineQueue.push(lineBuffer.trim());
    lineBuffer = '';
  }
  streamEnded = true;
  if (lineResolve) {
    lineResolve();
    lineResolve = null;
  }
});

child.on('error', (err) => {
  console.log('Spawn error:', err.message);
  streamError = err;
  streamEnded = true;
  if (lineResolve) {
    lineResolve();
    lineResolve = null;
  }
});

// Wait for all lines and print them
async function consumeLines() {
  while (true) {
    while (lineQueue.length === 0 && !streamEnded && !streamError) {
      await new Promise((resolve) => { lineResolve = resolve; });
    }
    if (streamError) {
      console.log('Stream error:', streamError.message);
      break;
    }
    if (lineQueue.length === 0 && streamEnded) {
      break;
    }
    const line = lineQueue.shift();
    if (!line) continue;
    try {
      const parsed = JSON.parse(line);
      console.log('MSG type:', parsed.type, '| subtype:', parsed.subtype || '-');
      if (parsed.type === 'assistant' && parsed.message) {
        console.log('  content blocks:', parsed.message.content ? parsed.message.content.map(b => b.type) : 'none');
        if (parsed.message.content) {
          for (const block of parsed.message.content) {
            if (block.type === 'text') console.log('  TEXT:', block.text.substring(0, 100));
            if (block.type === 'thinking') console.log('  THINKING:', block.thinking.substring(0, 100));
          }
        }
      }
      if (parsed.type === 'result') {
        console.log('  result:', parsed.result ? parsed.result.substring(0, 200) : 'none');
        console.log('  usage:', JSON.stringify(parsed.usage));
      }
    } catch (e) {
      console.log('PARSE ERROR:', line.substring(0, 200));
    }
    if (lineQueue.length === 0 && streamEnded) break;
  }
  console.log('Done consuming lines');
}

consumeLines();

setTimeout(() => {
  console.log('Timeout, killing process...');
  child.kill();
  process.exit(0);
}, 60000);
