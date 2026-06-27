const fs = require('fs');
const path = require('path');
const config = require('./config');

const LOG_FILE = config.logFile;
const MAX_BYTES = config.logMaxBytes || (10 * 1024 * 1024);
const MAX_FILES = config.logMaxFiles || 5;

// Ensure log directory exists
const logDir = path.dirname(LOG_FILE);
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

let logStream = null;
let bytesWritten = 0;

// Check current log file size and rotate if needed
function rotateIfNeeded() {
  try {
    if (!fs.existsSync(LOG_FILE)) {
      bytesWritten = 0;
      return;
    }
    const stat = fs.statSync(LOG_FILE);
    bytesWritten = stat.size;
    if (bytesWritten < MAX_BYTES) {
      return;
    }
    // Rotate: close current stream first
    if (logStream) {
      try { logStream.end(); } catch {}
      logStream = null;
    }
    // Shift existing rotated files: .4 -> .5, .3 -> .4, ..., .1 -> .2
    for (let i = MAX_FILES - 1; i >= 1; i--) {
      const src = `${LOG_FILE}.${i}`;
      const dst = `${LOG_FILE}.${i + 1}`;
      if (fs.existsSync(src)) {
        if (i + 1 > MAX_FILES) {
          // Drop files beyond MAX_FILES
          try { fs.unlinkSync(src); } catch {}
        } else {
          try { fs.renameSync(src, dst); } catch {}
        }
      }
    }
    // Move current log to .1
    try { fs.renameSync(LOG_FILE, `${LOG_FILE}.1`); } catch {}
    bytesWritten = 0;
  } catch {
    // Rotation failed — continue using existing stream
  }
}

function getLogStream() {
  if (!logStream) {
    rotateIfNeeded();
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
  const lineWithNewline = line + '\n';
  const lineBytes = Buffer.byteLength(lineWithNewline);
  try {
    // Check rotation lazily on every write (cheap stat check)
    if (bytesWritten + lineBytes > MAX_BYTES) {
      if (logStream) {
        try { logStream.end(); } catch {}
        logStream = null;
      }
      rotateIfNeeded();
    }
    getLogStream().write(lineWithNewline);
    bytesWritten += lineBytes;
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
