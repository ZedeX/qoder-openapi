const path = require('path');
const os = require('os');

const config = {
  // Gateway server port
  port: parseInt(process.env.GATEWAY_PORT || '9680', 10),

  // Gateway API key (optional, set via env var)
  apiKey: process.env.GATEWAY_API_KEY || '',

  // QoderWork installation paths
  qoderwork: {
    installDir: process.env.QODERWORK_DIR || 'd:\\_program\\QoderWork',
    resourceDir: process.env.QODERWORK_RESOURCE_DIR || 'd:\\_program\\QoderWork\\resources',
    storageDir: process.env.QODERWORK_STORAGE_DIR || path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'QoderWork'),
    cliPath: process.env.QODER_CLI_PATH || 'd:\\_program\\QoderWork\\resources\\bin\\qodercli.exe',
  },

  // Qoder CLI config directory (~/.qoder by default, where .auth/.models/logs live)
  // The SDK uses this as storageDir for session listing and auth.
  qoderConfigDir: process.env.QODER_CONFIG_DIR || path.join(os.homedir(), '.qoder'),

  // SDK module path (package was renamed from @ali/qoder-agent-sdk to @qoder-ai/qoder-agent-sdk)
  sdk: {
    modulePath: process.env.QODER_SDK_PATH || 'd:\\_program\\QoderWork\\resources\\app.asar.unpacked\\node_modules\\@qoder-ai\\qoder-agent-sdk',
  },

  // Integration mode for the SDK
  integrationMode: 'qoder_work',

  // Transport mode: 'auto' (try pipe then subprocess), 'pipe' (Named Pipe only), 'subprocess' (qodercli.exe only)
  transportMode: process.env.QODER_TRANSPORT_MODE || 'auto',

  // Named Pipe endpoint for connecting to running QoderWork instance
  chatPipe: process.env.QODER_CHAT_PIPE || '//./pipe/qoderwork-chat',

  // Available models mapping
  models: {
    'qwork-auto': {
      id: 'qwork-auto',
      name: 'QoderWork Auto',
      description: 'Auto-select best model',
      owned_by: 'qoder',
    },
    'qwork-ultimate': {
      id: 'qwork-ultimate',
      name: 'QoderWork Ultimate',
      description: 'Ultimate model with highest capability',
      owned_by: 'qoder',
    },
    'qmodel_latest': {
      id: 'qmodel_latest',
      name: 'QModel Latest',
      description: 'Latest Qoder model',
      owned_by: 'qoder',
    },
  },

  // Default model (qmodel_latest is free, qwork-auto/ultimate require subscription)
  defaultModel: 'qmodel_latest',

  // Default max turns for chat
  defaultMaxTurns: 1,

  // Default working directory for queries
  defaultCwd: process.cwd(),

  // Log file path
  logFile: path.join(__dirname, 'gateway.log'),

  // Log rotation: max file size in bytes before rotation (default 10 MB)
  logMaxBytes: parseInt(process.env.GATEWAY_LOG_MAX_BYTES || String(10 * 1024 * 1024), 10),

  // Log rotation: max number of historical log files to keep (gateway.log.1 .. gateway.log.N)
  logMaxFiles: parseInt(process.env.GATEWAY_LOG_MAX_FILES || '5', 10),

  // Request timeout (ms) — default 30 minutes to allow long agent runs
  requestTimeout: parseInt(process.env.GATEWAY_REQUEST_TIMEOUT || process.env.GATEWAY_TIMEOUT || '1800000', 10),
};

module.exports = config;
