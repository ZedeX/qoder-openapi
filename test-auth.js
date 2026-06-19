const { execSync } = require('child_process');
const path = require('path');

const cliPath = 'D:\\_program\\QoderWork\\resources\\bin\\qodercli.exe';
const storageDir = path.join(process.env.APPDATA, 'QoderWork');

// Test 1: Run qodercli status with QODER_WORK_INTEGRATION_MODE env
console.log('=== Test 1: With QODER_WORK_INTEGRATION_MODE ===');
try {
  const env = {
    ...process.env,
    QODER_WORK_INTEGRATION_MODE: '1',
    QODER_CONFIG_DIR: storageDir,
    QODERCN_CONFIG_DIR: storageDir,
  };
  const result = execSync(`"${cliPath}" status`, { env, timeout: 10000, encoding: 'utf8' });
  console.log(result);
} catch (e) {
  console.log('Error:', e.stderr || e.message);
}

// Test 2: Run qodercli status with --storage-dir flag
console.log('\n=== Test 2: Check if --storage-dir flag exists ===');
try {
  const result = execSync(`"${cliPath}" --help`, { timeout: 10000, encoding: 'utf8' });
  if (result.includes('storage-dir')) {
    console.log('--storage-dir flag found!');
  } else {
    console.log('--storage-dir flag NOT found');
  }
} catch (e) {
  console.log('Error:', e.stderr || e.message);
}

// Test 3: Try qodercli with QODER_ACCESS_TOKEN
console.log('\n=== Test 3: Check environment variables that qodercli might use ===');
const possibleEnvVars = [
  'QODER_ACCESS_TOKEN', 'QODER_TOKEN', 'QODER_API_KEY',
  'QODER_WORK_INTEGRATION_MODE', 'QODER_CONFIG_DIR', 'QODERCN_CONFIG_DIR',
  'QODER_SCENE', 'QODER_STORAGE_DIR', 'QODER_RESOURCE_DIR'
];
for (const v of possibleEnvVars) {
  console.log(`  ${v} = ${process.env[v] || '(not set)'}`);
}

// Test 4: Try qodercli --list-models with integration mode
console.log('\n=== Test 4: qodercli --list-models with integration env ===');
try {
  const env = {
    ...process.env,
    QODER_WORK_INTEGRATION_MODE: '1',
    QODER_CONFIG_DIR: storageDir,
    QODERCN_CONFIG_DIR: storageDir,
    QODER_SCENE: 'qwork',
  };
  const result = execSync(`"${cliPath}" --list-models -p`, { env, timeout: 15000, encoding: 'utf8' });
  console.log('Models:', result.substring(0, 500));
} catch (e) {
  console.log('Error:', (e.stderr || e.message).substring(0, 500));
}

// Test 5: Try the sign-request internal command
console.log('\n=== Test 5: qodercli internal sign-request ===');
try {
  const env = {
    ...process.env,
    QODER_WORK_INTEGRATION_MODE: '1',
    QODER_CONFIG_DIR: storageDir,
    QODERCN_CONFIG_DIR: storageDir,
  };
  const result = execSync(`"${cliPath}" internal sign-request --url /algo/api/v1/ping --storage-dir "${storageDir}"`, { env, timeout: 10000, encoding: 'utf8', input: '' });
  console.log('Sign result:', result.substring(0, 500));
} catch (e) {
  console.log('Error:', (e.stderr || e.message).substring(0, 500));
}
