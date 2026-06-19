const { spawn, execSync } = require('child_process');
const http = require('http');
const path = require('path');

const nodeExe = 'D:\\_program\\node\\node.exe';
const serverPath = path.join('d:\\_program\\QoderWork\\qoder-openapi', 'server.js');

// Check if server is already running
function checkServer() {
  return new Promise((resolve) => {
    const req = http.get('http://localhost:9680/health', (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => resolve(true));
    });
    req.on('error', () => resolve(false));
    req.setTimeout(3000, () => { req.destroy(); resolve(false); });
  });
}

async function main() {
  const running = await checkServer();
  if (running) {
    console.log('[OK] Server is already running on port 9680');
    return;
  }

  console.log('[INFO] Starting server...');
  const child = spawn(nodeExe, [serverPath], {
    cwd: 'd:\\_program\\QoderWork\\qoder-openapi',
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
    detached: true,
  });

  let output = '';
  child.stdout.on('data', (d) => { output += d.toString(); });
  child.stderr.on('data', (d) => { output += d.toString(); });

  // Wait for server to start
  for (let i = 0; i < 15; i++) {
    await new Promise(r => setTimeout(r, 1000));
    const ok = await checkServer();
    if (ok) {
      console.log('[OK] Server started successfully on port 9680');
      console.log('[INFO] Server output:', output.substring(0, 500));
      child.unref();
      process.exit(0);
    }
    console.log(`[INFO] Waiting for server... (${i + 1}s)`);
  }

  console.error('[FAIL] Server failed to start within 15s');
  console.error('[INFO] Output:', output.substring(0, 1000));
  process.exit(1);
}

main();
