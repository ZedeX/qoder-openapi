const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const MAX_LOGS = 1000;
const JSONL_FILE = path.join(__dirname, 'messages.jsonl');

class MessageLogger {
  constructor() {
    this.logs = new Map(); // id -> log entry
    this.logOrder = [];    // ordered list of IDs (FIFO)
    this._ensureJsonlDir();
  }

  _ensureJsonlDir() {
    const dir = path.dirname(JSONL_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  _appendToJsonl(entry) {
    // Fire-and-forget async append — avoids blocking the event loop on every
    // streamed chunk. Errors are logged but never thrown to the caller.
    try {
      const line = JSON.stringify(entry) + '\n';
      fs.promises.appendFile(JSONL_FILE, line, 'utf8').catch((err) => {
        console.error('[MessageLogger] Failed to append to JSONL:', err.message);
      });
    } catch (err) {
      console.error('[MessageLogger] Failed to serialize JSONL entry:', err.message);
    }
  }

  _trimLogs() {
    while (this.logOrder.length > MAX_LOGS) {
      const oldestId = this.logOrder.shift();
      this.logs.delete(oldestId);
    }
  }

  /**
   * Start a new message log entry
   * @param {object} request - The incoming request details
   * @returns {string} The log ID
   */
  startLog(request) {
    const id = uuidv4();
    const entry = {
      id,
      requestId: request.requestId || id,
      timestamp: new Date().toISOString(),
      duration: 0,
      request: {
        model: request.model || '',
        messages: request.messages || [],
        stream: !!request.stream,
        max_tokens: request.max_tokens || 0,
        temperature: request.temperature || 0,
        max_turns: request.max_turns || 0,
        prompt: request.prompt || '',
      },
      response: {
        content: '',
        thinking: '',
        toolUse: [],
        finishReason: '',
        usage: {},
      },
      sdkMessages: [],
      status: 'pending',
      error: null,
      _startTime: Date.now(),
    };

    this.logs.set(id, entry);
    this.logOrder.push(id);
    this._trimLogs();

    return id;
  }

  /**
   * Record an SDK message
   * @param {string} logId - The log entry ID
   * @param {object} msg - The SDK message
   */
  addSdkMessage(logId, msg) {
    const entry = this.logs.get(logId);
    if (!entry) return;

    // Store a sanitized copy (avoid circular refs, limit size)
    let sanitized;
    try {
      const msgCopy = {
        type: msg.type,
        subtype: msg.subtype || undefined,
      };

      // For stream_event, store key fields
      if (msg.type === 'stream_event' && msg.event) {
        const event = msg.event;
        msgCopy.event = {
          type: event.type,
          delta: event.delta ? { ...event.delta } : undefined,
          content_block: event.content_block ? { ...event.content_block } : undefined,
        };
      }
      // For assistant messages, store content block types
      else if (msg.type === 'assistant' && msg.message) {
        msgCopy.message = {
          role: msg.message.role,
          content: (msg.message.content || []).map(block => ({
            type: block.type,
            // Truncate large text/thinking to avoid memory bloat
            text: block.text ? block.text.substring(0, 500) : undefined,
            thinking: block.thinking ? block.thinking.substring(0, 500) : undefined,
            id: block.id || undefined,
            name: block.name || undefined,
          })),
        };
      }
      // For result messages, store key info
      else if (msg.type === 'result') {
        msgCopy.subtype = msg.subtype;
        msgCopy.usage = msg.usage || undefined;
        msgCopy.result = msg.result ? String(msg.result).substring(0, 200) : undefined;
      }

      sanitized = msgCopy;
    } catch {
      sanitized = { type: msg.type, _error: 'serialization failed' };
    }

    entry.sdkMessages.push(sanitized);
  }

  /**
   * Record thinking content
   * @param {string} logId - The log entry ID
   * @param {string} text - Thinking text
   */
  addThinking(logId, text) {
    const entry = this.logs.get(logId);
    if (!entry) return;
    entry.response.thinking += text;
  }

  /**
   * Record text content
   * @param {string} logId - The log entry ID
   * @param {string} text - Content text
   */
  addContent(logId, text) {
    const entry = this.logs.get(logId);
    if (!entry) return;
    entry.response.content += text;
  }

  /**
   * Record a tool use call
   * @param {string} logId - The log entry ID
   * @param {object} toolInfo - Tool use information
   */
  addToolUse(logId, toolInfo) {
    const entry = this.logs.get(logId);
    if (!entry) return;
    entry.response.toolUse.push({
      id: toolInfo.id || '',
      type: toolInfo.type || 'tool_use',
      name: toolInfo.name || '',
      input: toolInfo.input || {},
    });
  }

  /**
   * Mark a log entry as completed
   * @param {string} logId - The log entry ID
   * @param {object} response - Response details
   */
  completeLog(logId, response) {
    const entry = this.logs.get(logId);
    if (!entry) return;

    entry.status = 'completed';
    entry.duration = Date.now() - entry._startTime;

    if (response) {
      if (response.content) entry.response.content = response.content;
      if (response.thinking) entry.response.thinking = response.thinking;
      if (response.toolUse) entry.response.toolUse = response.toolUse;
      if (response.finishReason) entry.response.finishReason = response.finishReason;
      if (response.usage) entry.response.usage = response.usage;
    }

    // Remove internal field before persisting
    const persistEntry = { ...entry };
    delete persistEntry._startTime;
    this._appendToJsonl(persistEntry);
  }

  /**
   * Mark a log entry as errored
   * @param {string} logId - The log entry ID
   * @param {string} error - Error message
   */
  errorLog(logId, error) {
    const entry = this.logs.get(logId);
    if (!entry) return;

    entry.status = 'error';
    entry.error = error || 'Unknown error';
    entry.duration = Date.now() - entry._startTime;

    const persistEntry = { ...entry };
    delete persistEntry._startTime;
    this._appendToJsonl(persistEntry);
  }

  /**
   * Get paginated list of log entries (newest first)
   * @param {number} limit - Max entries to return
   * @param {number} offset - Number of entries to skip
   * @returns {object} Paginated result
   */
  getLogs(limit = 50, offset = 0) {
    const total = this.logOrder.length;
    const reversed = [...this.logOrder].reverse();
    const sliced = reversed.slice(offset, offset + limit);

    const items = sliced.map(id => {
      const entry = this.logs.get(id);
      if (!entry) return null;
      // Return summary (exclude sdkMessages and full request messages for list view)
      return {
        id: entry.id,
        requestId: entry.requestId,
        timestamp: entry.timestamp,
        duration: entry.duration,
        status: entry.status,
        error: entry.error,
        request: {
          model: entry.request.model,
          stream: entry.request.stream,
          messageCount: entry.request.messages.length,
          promptLength: entry.request.prompt.length,
        },
        response: {
          contentLength: entry.response.content.length,
          thinkingLength: entry.response.thinking.length,
          toolUseCount: entry.response.toolUse.length,
          finishReason: entry.response.finishReason,
          usage: entry.response.usage,
        },
      };
    }).filter(Boolean);

    return {
      total,
      limit,
      offset,
      items,
    };
  }

  /**
   * Get a specific log entry with full details
   * @param {string} id - The log entry ID
   * @returns {object|null} Full log entry or null
   */
  getLog(id) {
    const entry = this.logs.get(id);
    if (!entry) return null;
    // Return full entry but remove internal fields
    const result = { ...entry };
    delete result._startTime;
    return result;
  }

  /**
   * Clear all in-memory logs
   */
  clearLogs() {
    this.logs.clear();
    this.logOrder = [];
  }
}

// Singleton instance
const messageLogger = new MessageLogger();

module.exports = messageLogger;
