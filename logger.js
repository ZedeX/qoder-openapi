const fs = require('fs');
const path = require('path');
const config = require('./config');

const LOG_FILE = config.logFile;

// Ensure log directory exists
const logDir = path.dirname(LOG_FILE);
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

let logStream = null;

function getLogStream() {
  if (!logStream) {
    logStream = fs.createWriteStream(LOG_FILE, { flags: 'a' });
  }
  return logStream;
}

function formatMessage(level, message, meta) {
  const timestamp = new Date().toISOString();
  let line = `[${timestamp}] [${level}] ${message}`;
  if (meta && Object.keys(meta).length > 0) {
    try {
      line += ' ' + JSON.stringify(meta);
    } catch {
      line += ' [meta serialization failed]';
    }
  }
  return line;
}

function writeLog(level, message, meta) {
  const line = formatMessage(level, message, meta);
  try {
    getLogStream().write(line + '\n');
  } catch {
    // Fallback to console if stream fails
  }

  // Also output to console for DEBUG and INFO
  if (level === 'ERROR' || level === 'WARN') {
    console.error(line);
  } else {
    console.log(line);
  }
}

const logger = {
  debug: (message, meta) => writeLog('DEBUG', message, meta),
  info: (message, meta) => writeLog('INFO', message, meta),
  warn: (message, meta) => writeLog('WARN', message, meta),
  error: (message, meta) => writeLog('ERROR', message, meta),
};

module.exports = logger;
