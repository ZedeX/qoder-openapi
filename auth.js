const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const config = require('./config');

const logger = require('./logger');

// Token cache
let cachedToken = null;
let tokenExpiry = 0;
const TOKEN_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Get access token from environment variable
 */
function getEnvToken() {
  return process.env.QODER_ACCESS_TOKEN || process.env.QODER_API_KEY || null;
}

/**
 * Get login status by running qodercli status command
 */
function getStatusFromCli() {
  return new Promise((resolve) => {
    const cliPath = config.qoderwork.cliPath;
    if (!fs.existsSync(cliPath)) {
      resolve({ loggedIn: false, error: 'CLI not found' });
      return;
    }

    const env = { ...process.env };
    if (config.qoderwork.storageDir) {
      env.QODERCLI_STORAGE_DIR = config.qoderwork.storageDir;
    }

    const proc = execFile(cliPath, ['status'], {
      env,
      timeout: 10000,
      windowsHide: true,
    }, (error, stdout, stderr) => {
      if (error) {
        logger.warn('CLI status check failed', { error: error.message, stderr });
        resolve({ loggedIn: false, error: error.message });
        return;
      }

      const output = (stdout || '').trim();
      const loggedIn = output.toLowerCase().includes('logged in') && !output.toLowerCase().includes('not logged in');

      // Parse username from output like "Account: username (email@example.com)"
      let username = '';
      let email = '';
      const accountMatch = output.match(/Account:\s*(.+)/i);
      if (accountMatch) {
        const accountInfo = accountMatch[1].trim();
        const emailMatch = accountInfo.match(/\(([^)]+)\)/);
        if (emailMatch) {
          email = emailMatch[1];
          username = accountInfo.replace(/\([^)]+\)/, '').trim();
        } else {
          username = accountInfo;
        }
      }

      resolve({ loggedIn, username, email, raw: output });
    });

    proc.on('error', (err) => {
      resolve({ loggedIn: false, error: err.message });
    });
  });
}

/**
 * Get access token using the SDK client
 * This creates a temporary SDK client connection to check status
 */
async function getAccessToken() {
  // 1. Check environment variable first
  const envToken = getEnvToken();
  if (envToken) {
    logger.debug('Using token from environment variable');
    return envToken;
  }

  // 2. Check cache
  if (cachedToken && Date.now() < tokenExpiry) {
    logger.debug('Using cached token');
    return cachedToken;
  }

  // 3. Try to get token from SDK client
  try {
    const sdk = require(config.sdk.modulePath);
    const client = new sdk.QoderAgentSDKClient({
      pathToQoderCLIExecutable: config.qoderwork.cliPath,
      storageDir: config.qoderwork.storageDir,
      resourceDir: config.qoderwork.resourceDir,
      integrationMode: config.integrationMode,
    });

    await client.connect();
    const status = await client.getStatus();
    await client.disconnect();

    if (status && status.loggedIn) {
      logger.info('Got login status from SDK', { username: status.username });
      // The SDK handles auth internally via the CLI process
      // We don't get a raw token, but the CLI will use stored credentials
      cachedToken = '__sdk_managed__';
      tokenExpiry = Date.now() + TOKEN_CACHE_TTL;
      return cachedToken;
    }
  } catch (err) {
    logger.warn('Failed to get token from SDK client', { error: err.message });
  }

  // 4. Try CLI status check as fallback
  const status = await getStatusFromCli();
  if (status.loggedIn) {
    logger.info('User is logged in according to CLI', { username: status.username });
    cachedToken = '__cli_managed__';
    tokenExpiry = Date.now() + TOKEN_CACHE_TTL;
    return cachedToken;
  }

  logger.warn('No access token available - user may not be logged in');
  return null;
}

/**
 * Check if the user is logged in to QoderWork
 */
async function checkLoginStatus() {
  // Try environment token first
  const envToken = getEnvToken();
  if (envToken) {
    return {
      loggedIn: true,
      source: 'environment',
      username: 'env-user',
    };
  }

  // Try SDK client
  try {
    const sdk = require(config.sdk.modulePath);
    const client = new sdk.QoderAgentSDKClient({
      pathToQoderCLIExecutable: config.qoderwork.cliPath,
      storageDir: config.qoderwork.storageDir,
      resourceDir: config.qoderwork.resourceDir,
      integrationMode: config.integrationMode,
    });

    await client.connect();
    const status = await client.getStatus();
    await client.disconnect();

    return {
      loggedIn: status.loggedIn,
      username: status.username,
      email: status.email,
      plan: status.plan,
      version: status.version,
      source: 'sdk',
    };
  } catch (err) {
    logger.warn('SDK status check failed, falling back to CLI', { error: err.message });
  }

  // Fallback to CLI
  const status = await getStatusFromCli();
  return {
    loggedIn: status.loggedIn,
    username: status.username,
    email: status.email,
    source: 'cli',
    raw: status.raw,
  };
}

/**
 * Set the access token manually (for use when token is obtained externally)
 */
function setAccessToken(token) {
  cachedToken = token;
  tokenExpiry = Date.now() + TOKEN_CACHE_TTL;
  logger.info('Access token set manually');
}

/**
 * Clear the cached token
 */
function clearTokenCache() {
  cachedToken = null;
  tokenExpiry = 0;
}

module.exports = {
  getAccessToken,
  checkLoginStatus,
  setAccessToken,
  clearTokenCache,
  getEnvToken,
};
