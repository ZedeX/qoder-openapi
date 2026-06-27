/**
 * Session Store - Manages chat sessions with persistence
 * Each session has: id, title, model, messages, createdAt, updatedAt
 * Sessions are persisted to data/sessions.json
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const SESSIONS_FILE = path.join(DATA_DIR, 'sessions.json');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// In-memory store
let sessions = {};
let sessionOrder = []; // ordered list of session IDs (newest first)

// Load from disk
function load() {
  try {
    if (fs.existsSync(SESSIONS_FILE)) {
      const raw = fs.readFileSync(SESSIONS_FILE, 'utf-8');
      const data = JSON.parse(raw);
      sessions = data.sessions || {};
      sessionOrder = data.order || Object.keys(sessions);
    }
  } catch (e) {
    console.error('Failed to load sessions:', e.message);
    sessions = {};
    sessionOrder = [];
  }
}

// Save to disk (debounced async to avoid blocking the event loop on every
// message append). Call flushSave() at process exit to ensure pending writes
// are persisted.
let saveTimer = null;
const SAVE_DEBOUNCE_MS = 300;

function save() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    doSave();
  }, SAVE_DEBOUNCE_MS);
}

function doSave() {
  try {
    const data = { sessions, order: sessionOrder, savedAt: new Date().toISOString() };
    fs.promises.writeFile(SESSIONS_FILE, JSON.stringify(data, null, 2), 'utf-8').catch((e) => {
      console.error('Failed to save sessions:', e.message);
    });
  } catch (e) {
    console.error('Failed to serialize sessions:', e.message);
  }
}

// Force-flush any pending debounced save (used at process exit)
function flushSave() {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  try {
    const data = { sessions, order: sessionOrder, savedAt: new Date().toISOString() };
    fs.writeFileSync(SESSIONS_FILE, JSON.stringify(data, null, 2), 'utf-8');
  } catch (e) {
    console.error('Failed to flush sessions:', e.message);
  }
}

// Ensure pending writes are flushed when the process exits
process.on('exit', flushSave);
process.on('SIGINT', () => { flushSave(); process.exit(0); });
process.on('SIGTERM', () => { flushSave(); process.exit(0); });

// Generate unique ID
function generateId() {
  return 'sess_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 8);
}

// Auto-generate title from first user message
function generateTitle(messages) {
  for (const msg of messages) {
    if (msg.role === 'user' && msg.content) {
      const text = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
      return text.substring(0, 60) + (text.length > 60 ? '...' : '');
    }
  }
  return 'New Chat';
}

// ==================== CRUD ====================

/**
 * List all sessions (summary only, no messages)
 */
function listSessions() {
  return sessionOrder.map(id => {
    const s = sessions[id];
    if (!s) return null;
    return {
      id: s.id,
      title: s.title,
      model: s.model,
      messageCount: s.messages.length,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
    };
  }).filter(Boolean);
}

/**
 * Create a new session
 */
function createSession(opts = {}) {
  const id = generateId();
  const now = new Date().toISOString();
  const session = {
    id,
    title: opts.title || 'New Chat',
    model: opts.model || 'qmodel_latest',
    messages: opts.messages || [],
    createdAt: now,
    updatedAt: now,
  };
  sessions[id] = session;
  sessionOrder.unshift(id); // newest first
  save();
  return session;
}

/**
 * Get a session by ID (full data including messages)
 */
function getSession(id) {
  return sessions[id] || null;
}

/**
 * Update a session
 */
function updateSession(id, updates) {
  const session = sessions[id];
  if (!session) return null;

  if (updates.title !== undefined) session.title = updates.title;
  if (updates.model !== undefined) session.model = updates.model;
  if (updates.messages !== undefined) session.messages = updates.messages;

  session.updatedAt = new Date().toISOString();

  // Auto-title if still default
  if (session.title === 'New Chat' && session.messages.length > 0) {
    session.title = generateTitle(session.messages);
  }

  save();
  return session;
}

/**
 * Add a message to a session
 */
function addMessage(id, message) {
  const session = sessions[id];
  if (!session) return null;

  session.messages.push(message);
  session.updatedAt = new Date().toISOString();

  // Auto-title on first user message
  if (session.title === 'New Chat' && message.role === 'user') {
    session.title = generateTitle([message]);
  }

  save();
  return session;
}

/**
 * Delete a session
 */
function deleteSession(id) {
  if (!sessions[id]) return false;
  delete sessions[id];
  sessionOrder = sessionOrder.filter(sid => sid !== id);
  save();
  return true;
}

/**
 * Clear all sessions
 */
function clearAllSessions() {
  sessions = {};
  sessionOrder = [];
  save();
  return true;
}

// Initialize
load();

module.exports = {
  listSessions,
  createSession,
  getSession,
  updateSession,
  addMessage,
  deleteSession,
  clearAllSessions,
  flushSave,
};
