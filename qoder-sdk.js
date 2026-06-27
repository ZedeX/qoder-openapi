/**
 * Qoder SDK Wrapper
 *
 * Three layers of capability:
 * 1. Local file operations (listSessions, etc.) — synchronous, no IDE needed
 * 2. Pipe-based operations (getUsage, getModels) — need IDE running
 * 3. CLI operations (skills, agents, mcp) — spawn qodercli.exe
 */

const { execFile } = require('child_process');
const path = require('path');
const config = require('./config');
const logger = require('./logger');

const sdk = require(config.sdk.modulePath);

let sdkConfigured = false;
function ensureConfigured() {
  if (!sdkConfigured) {
    sdk.configure({
      storageDir: config.qoderConfigDir || config.qoderwork.storageDir,
      resourceDir: config.qoderwork.resourceDir,
      integrationMode: config.integrationMode,
    });
    sdkConfigured = true;
    logger.debug('SDK configured', { storageDir: config.qoderConfigDir || config.qoderwork.storageDir });
  }
}

// ============================================================
// LAYER 1: Local Session Operations (synchronous, no IDE needed)
// ============================================================

function listSessions(options = {}) {
  ensureConfigured();
  return sdk.listSessions(options);
}

function getSessionInfo(sessionId, directory) {
  ensureConfigured();
  return sdk.getSessionInfo(sessionId, directory);
}

function getSessionMessages(sessionId, options = {}) {
  ensureConfigured();
  return sdk.getSessionMessages(sessionId, options);
}

function renameSession(sessionId, title, directory) {
  ensureConfigured();
  sdk.renameSession(sessionId, title, directory);
  return { success: true, sessionId, title };
}

function tagSession(sessionId, tag, directory) {
  ensureConfigured();
  sdk.tagSession(sessionId, tag, directory);
  return { success: true, sessionId, tag };
}

function getProjectsDir() {
  ensureConfigured();
  return sdk.getProjectsDir();
}

// ============================================================
// LAYER 2: Pipe-Based Operations (need IDE running)
// With CLI fallbacks for operations that have CLI equivalents.
// ============================================================

// Try multiple pipe names — the IDE may use different names across versions
const PIPE_CANDIDATES = [
  config.chatPipe,
  '//./pipe/qoderwork-chat',
  '//./pipe/qoderwork-mcp',
];

// Cache pipe check result to avoid slow retries on every request
let pipeCheckCache = null; // { result: bool, checkedAt: number, lastWorkingPipe?: string }
const PIPE_CACHE_TTL = 30000; // 30 seconds

async function checkPipeConnectable() {
  // Return cached result if fresh
  if (pipeCheckCache && Date.now() - pipeCheckCache.checkedAt < PIPE_CACHE_TTL) {
    return pipeCheckCache.result;
  }
  // Try all pipes in parallel — fastest wins
  try {
    const results = await Promise.all(
      PIPE_CANDIDATES.map((pipe) =>
        sdk.isConnectable({ chatEndpoint: pipe, timeoutMs: 1500 })
          .then((r) => ({ pipe, ok: r === true }))
          .catch(() => ({ pipe, ok: false }))
      )
    );
    const working = results.find((r) => r.ok);
    const connectable = !!working;
    pipeCheckCache = {
      result: connectable,
      checkedAt: Date.now(),
      lastWorkingPipe: working ? working.pipe : undefined,
    };
    return connectable;
  } catch {
    pipeCheckCache = { result: false, checkedAt: Date.now() };
    return false;
  }
}

async function withPipeClient(fn) {
  // CRITICAL: Always pre-check via isConnectable (cached).
  // The SDK's client.connect() calls createSocketConnection() WITHOUT a timeout,
  // so connecting to a pipe that exists but doesn't respond would block forever.
  // isConnectable() uses timeoutMs internally, so it's the only safe way to test.
  const connectable = await checkPipeConnectable();
  if (!connectable) {
    throw new Error('Pipe unavailable (isConnectable returned false)');
  }

  // connectable is true — try the actual connect. Use Promise.race to enforce a
  // 5s timeout as a safety net in case connect() still hangs.
  const CONNECT_TIMEOUT_MS = 5000;
  const client = new sdk.QoderAgentSDKClient({
    pathToQoderCLIExecutable: config.qoderwork.cliPath,
    storageDir: config.qoderConfigDir || config.qoderwork.storageDir,
    resourceDir: config.qoderwork.resourceDir,
    integrationMode: config.integrationMode,
    permissionMode: 'bypassPermissions',
    allowDangerouslySkipPermissions: true,
    chatEndpoint: pipeCheckCache.lastWorkingPipe || config.chatPipe,
  });
  let timeoutHandle = null;
  try {
    await Promise.race([
      client.connect(),
      new Promise((_, reject) => {
        timeoutHandle = setTimeout(
          () => reject(new Error(`client.connect() timed out after ${CONNECT_TIMEOUT_MS}ms`)),
          CONNECT_TIMEOUT_MS
        );
      }),
    ]);
    const result = await fn(client);
    await client.disconnect();
    if (timeoutHandle) clearTimeout(timeoutHandle);
    pipeCheckCache = { result: true, checkedAt: Date.now(), lastWorkingPipe: pipeCheckCache.lastWorkingPipe };
    return result;
  } catch (err) {
    if (timeoutHandle) clearTimeout(timeoutHandle);
    try { await client.disconnect(); } catch {}
    // Mark pipe as down so subsequent calls skip the slow connect() attempt
    pipeCheckCache = { result: false, checkedAt: Date.now() };
    throw err;
  }
}

/**
 * Parse `qodercli status` text output into structured data.
 * Format: "Version: x.y.z\nUsername: name\nEmail: email\nAvatar: url"
 */
function parseCliStatus(stdout) {
  const text = stdout.trim();
  const get = (key) => {
    const m = text.match(new RegExp(`${key}:\\s*(.+)`, 'i'));
    return m ? m[1].trim() : '';
  };
  const username = get('Username');
  const email = get('Email');
  const version = get('Version');
  const avatar = get('Avatar');
  return {
    loggedIn: !!(username && email),
    username,
    email,
    version,
    avatarUrl: avatar,
    source: 'cli',
  };
}

/**
 * Parse `qodercli --list-models` output.
 * Format: "MODEL\nQwen3.7-Max\n" or just "Qwen3.7-Max"
 * Also handles: "MODEL\nWarning: no models available for your account."
 */
function parseCliModels(stdout) {
  const lines = stdout.trim().split('\n').map((l) => l.trim()).filter(Boolean);
  // Detect "no models available" warning (subscription issue / not provisioned)
  const warningLine = lines.find((l) => /^warning:/i.test(l));
  const noModels = lines.some((l) => /no models available/i.test(l));
  if (noModels) {
    return {
      models: [],
      warning: warningLine || 'No models available for your account',
      fallback: true,
      source: 'cli',
    };
  }
  const models = lines
    .filter((l) => l !== 'MODEL' && !l.startsWith('-') && !/^warning:/i.test(l))
    .map((name) => ({
      key: name,
      displayName: name,
      enable: true,
      isDefault: false,
      source: 'cli',
    }));
  return { models };
}

async function getAccountStatus() {
  // Try pipe first
  try {
    return await withPipeClient((c) => c.getStatus());
  } catch {
    // Fall back to CLI
    const { stdout } = await runCli(['status'], { timeout: 10000 });
    return parseCliStatus(stdout);
  }
}

async function getUsage() {
  // Pipe only — no CLI fallback available
  return withPipeClient((c) => c.getUsage());
}

async function getRealModels(options) {
  // Try pipe first
  try {
    return await withPipeClient((c) => c.getModels(options));
  } catch {
    // Fall back to CLI --list-models.
    // NOTE: qodercli writes the "MODEL" header to stdout but the
    // "Warning: no models available" message to STDERR, so we must
    // inspect both streams to detect the subscription issue.
    const { stdout, stderr } = await runCli(['--list-models'], { timeout: 10000 });
    const result = parseCliModels(stdout);
    result.fallback = true;
    result.source = 'cli';
    // Surface any warning from stderr (e.g. "no models available for your account")
    if (stderr && stderr.trim()) {
      const stderrWarning = stderr.trim().split('\n').map((l) => l.trim()).find((l) => /^warning:/i.test(l));
      if (stderrWarning) {
        result.warning = stderrWarning;
      } else if (!result.models.length) {
        // Empty model list with unrecognised stderr — surface it as a hint
        result.warning = stderr.trim();
      }
    }
    // If CLI returned no models, fall back to the gateway's hardcoded model
    // aliases (from config.js). These are the model IDs the gateway accepts
    // in /v1/chat/completions requests, so users should still see them even
    // when the CLI can't enumerate real models (e.g. subscription issue).
    if (!result.models.length) {
      const configModels = Object.values(config.models || {});
      if (configModels.length) {
        result.models = configModels.map((m) => ({
          key: m.id,
          displayName: m.name,
          description: m.description,
          enable: true,
          isDefault: m.id === config.defaultModel,
          source: 'gateway',
          ownedBy: m.owned_by,
        }));
        result.source = 'gateway';
        if (!result.warning) {
          result.warning = 'CLI 未返回模型列表，已回退到网关内置模型别名';
        }
      }
    }
    return result;
  }
}

async function getDataPolicy() {
  // Pipe only — no CLI fallback available
  return withPipeClient((c) => c.getDataPolicy());
}

async function checkQoderWorkAccess() {
  // Pipe only — no CLI fallback available
  return withPipeClient((c) => c.checkQoderWorkAccess());
}

// ============================================================
// LAYER 3: CLI Operations (spawn qodercli.exe)
// ============================================================

function runCli(args, options = {}) {
  return new Promise((resolve, reject) => {
    const cliPath = config.qoderwork.cliPath;
    const env = { ...process.env };
    if (config.qoderwork.storageDir) {
      env.QODERCLI_STORAGE_DIR = config.qoderwork.storageDir;
    }
    execFile(cliPath, args, {
      env,
      timeout: options.timeout || 30000,
      windowsHide: true,
      maxBuffer: 10 * 1024 * 1024,
      cwd: options.cwd || config.defaultCwd,
    }, (error, stdout, stderr) => {
      if (error) {
        reject({ error: error.message, stdout: stdout || '', stderr: stderr || '' });
      } else {
        resolve({ stdout: stdout || '', stderr: stderr || '' });
      }
    });
  });
}

/**
 * Parse skills list output from `qodercli skills list`
 * Format: "name [Enabled/Disabled]\n  Description: ...\n  Location: ..."
 */
function parseSkillsList(stdout) {
  const skills = [];
  const lines = stdout.split('\n');
  let current = null;
  for (const line of lines) {
    const nameMatch = line.match(/^(\S+)\s*\[(Enabled|Disabled)\]/);
    if (nameMatch) {
      if (current) skills.push(current);
      current = { name: nameMatch[1], enabled: nameMatch[2] === 'Enabled', description: '', location: '' };
    } else if (current) {
      const descMatch = line.match(/^\s*Description:\s*(.+)/i);
      if (descMatch) current.description = descMatch[1].trim();
      const locMatch = line.match(/^\s*Location:\s*(.+)/i);
      if (locMatch) current.location = locMatch[1].trim();
    }
  }
  if (current) skills.push(current);
  return skills;
}

/**
 * Parse agents list output from `qodercli agents list`
 * Format: "N active agents\n\nBuilt-in:\n  name · model\n..."
 */
function parseAgentsList(stdout) {
  const agents = [];
  const lines = stdout.split('\n');
  let section = '';
  for (const line of lines) {
    const sectionMatch = line.match(/^(Built-in|Custom):/i);
    if (sectionMatch) {
      section = sectionMatch[1].toLowerCase();
      continue;
    }
    const agentMatch = line.match(/^\s+(\S+)\s*[·•]\s*(\S+)/);
    if (agentMatch) {
      agents.push({ name: agentMatch[1], model: agentMatch[2], type: section || 'builtin' });
    }
  }
  return agents;
}

/**
 * Parse MCP list output
 */
function parseMcpList(stdout) {
  const text = stdout.trim();
  if (text.includes('No MCP servers configured')) {
    return [];
  }
  const servers = [];
  const lines = text.split('\n');
  for (const line of lines) {
    const match = line.match(/^\s*(\S+)\s*-\s*(.+)/);
    if (match) {
      servers.push({ name: match[1], status: match[2].trim() });
    }
  }
  return servers;
}

async function listSkills() {
  const { stdout } = await runCli(['skills', 'list']);
  return parseSkillsList(stdout);
}

async function listAgents() {
  const { stdout } = await runCli(['agents', 'list']);
  return parseAgentsList(stdout);
}

async function listMcpServers() {
  const { stdout } = await runCli(['mcp', 'list']);
  return parseMcpList(stdout);
}

async function listPlugins() {
  const { stdout } = await runCli(['plugins', 'list']);
  const text = stdout.trim();
  if (text.includes('No plugins installed')) {
    return [];
  }
  return [{ raw: text }];
}

async function getConfigValue(key) {
  const { stdout } = await runCli(['config', 'get', key]);
  return { key, value: stdout.trim() };
}

async function submitFeedback(params) {
  const args = ['feedback'];
  if (params.content) args.push('--content', params.content);
  if (params.email) args.push('--email', params.email);
  if (params.sessionId) args.push('--session-id', params.sessionId);
  const { stdout } = await runCli(args, { timeout: 60000 });
  return { success: true, output: stdout.trim() };
}

async function generateCommit(message, cwd) {
  const args = message ? ['commit', '-m', message] : ['commit'];
  const { stdout } = await runCli(args, { timeout: 120000, cwd });
  return { success: true, output: stdout.trim() };
}

async function generateWiki(args, cwd) {
  const cliArgs = ['wiki'];
  if (Array.isArray(args)) cliArgs.push(...args);
  const { stdout } = await runCli(cliArgs, { timeout: 120000, cwd });
  return { success: true, output: stdout.trim() };
}

module.exports = {
  // Layer 1: Local
  listSessions,
  getSessionInfo,
  getSessionMessages,
  renameSession,
  tagSession,
  getProjectsDir,
  // Layer 2: Pipe + CLI fallback
  checkPipeConnectable,
  withPipeClient,
  getAccountStatus,
  getUsage,
  getRealModels,
  getDataPolicy,
  checkQoderWorkAccess,
  parseCliStatus,
  parseCliModels,
  // Layer 3: CLI
  runCli,
  listSkills,
  listAgents,
  listMcpServers,
  listPlugins,
  getConfigValue,
  submitFeedback,
  generateCommit,
  generateWiki,
};
