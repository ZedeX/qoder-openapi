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

  // SDK module path
  sdk: {
    modulePath: process.env.QODER_SDK_PATH || 'd:\\_program\\QoderWork\\resources\\app.asar.unpacked\\node_modules\\@ali\\qoder-agent-sdk',
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

  // Default model
  defaultModel: 'qwork-auto',

  // Default max turns for chat
  defaultMaxTurns: 1,

  // Default working directory for queries
  defaultCwd: process.cwd(),

  // Log file path
  logFile: path.join(__dirname, 'gateway.log'),

  // Request timeout (ms)
  requestTimeout: parseInt(process.env.GATEWAY_TIMEOUT || '300000', 10),
};

module.exports = config;
