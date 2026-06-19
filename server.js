const express = require('express');
const cors = require('cors');
const path = require('path');
const { spawn } = require('child_process');
const config = require('./config');
const logger = require('./logger');
const auth = require('./auth');
const converter = require('./converter');
const messageLogger = require('./message-logger');

// Save original process.env BEFORE SDK configure() modifies it
// (sdk.query() sets process.env.QODER_ENTRYPOINT = "sdk-ts")
const originalProcessEnv = { ...process.env };

// Initialize and configure the SDK
let sdk = null;
let sdkConfigured = false;

function initSDK() {
  if (sdkConfigured) return;

  try {
    logger.info('Loading Qoder Agent SDK', { modulePath: config.sdk.modulePath });
    sdk = require(config.sdk.modulePath);

    logger.info('Configuring SDK', {
      storageDir: config.qoderwork.storageDir,
      resourceDir: config.qoderwork.resourceDir,
      integrationMode: config.integrationMode,
    });

    sdk.configure({
      storageDir: config.qoderwork.storageDir,
      resourceDir: config.qoderwork.resourceDir,
      integrationMode: config.integrationMode,
    });

    sdkConfigured = true;
    logger.info('SDK configured successfully');
  } catch (err) {
    logger.error('Failed to initialize SDK', { error: err.message, stack: err.stack });
    throw err;
  }
}

// ==================== Direct CLI Transport ====================

/**
 * Query qodercli.exe directly via child_process.spawn, bypassing the SDK entirely.
 * This avoids the SDK's configure() with integrationMode 'qoder_work' which
 * interferes with subprocess communication and returns empty responses.
 *
 * @param {string} prompt - The prompt text to send
 * @param {object} options - Query options (model, maxTurns, abortController, etc.)
 * @returns {AsyncIterable} - Yields messages in the same format as SDK query()
 */
async function* queryViaDirectCLI(prompt, options = {}) {
  const cliPath = config.qoderwork.cliPath;
  const model = options.model || config.defaultModel;
  const maxTurns = options.maxTurns || config.defaultMaxTurns;
  const abortController = options.abortController || new AbortController();

  const args = [
    '--model', model,
    '--max-turns', String(maxTurns),
    '--output-format', 'stream-json',
    'prompt', prompt,
  ];

  // Build a clean environment for the child process:
  // Use originalProcessEnv (saved before SDK configure/query modified process.env)
  // and remove any SDK-related env vars that could interfere with qodercli.
  const cleanEnv = { ...originalProcessEnv };
  delete cleanEnv.QODERCLI_STORAGE_DIR;
  delete cleanEnv.QODERCLI_RESOURCE_DIR;
  delete cleanEnv.QODER_ENTRYPOINT;
  delete cleanEnv.QODERCLI_INTEGRATION_MODE;
  delete cleanEnv.QODER_ENABLE_SDK_FILE_CHECKPOINTING;

  logger.info('Spawning qodercli.exe directly', { cliPath, args: args.join(' ') });

  const child = spawn(cliPath, args, {
    cwd: options.cwd || config.defaultCwd,
    env: cleanEnv,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });

  logger.info('qodercli spawn initiated, PID:', { pid: child.pid });

  // Log spawn event for debugging
  child.on('spawn', () => {
    logger.info('DirectCLI: child spawn event fired', { pid: child.pid });
  });

  // Handle abort signal
  const onAbort = () => {
    logger.info('Direct CLI query aborted, killing child process');
    try { child.kill(); } catch {}
  };

  logger.info('DirectCLI: checking abort signal', { aborted: abortController.signal.aborted });
  if (abortController.signal.aborted) {
    logger.info('DirectCLI: abort signal already set, returning early');
    child.kill();
    return;
  }
  abortController.signal.addEventListener('abort', onAbort, { once: true });

  // Buffer for incomplete lines
  let lineBuffer = '';

  // Create a promise-based line reader
  const lineQueue = [];
  let lineResolve = null;
  let streamEnded = false;
  let streamError = null;

  logger.info('DirectCLI: setting up stdout handler');
  child.stdout.on('data', (data) => {
    const rawText = data.toString();
    logger.info('DirectCLI: stdout data received', { bytes: rawText.length, preview: rawText.substring(0, 200) });
    lineBuffer += rawText;
    const lines = lineBuffer.split('\n');
    // Keep the last incomplete line in the buffer
    lineBuffer = lines.pop() || '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed) {
        lineQueue.push(trimmed);
        if (lineResolve) {
          lineResolve();
          lineResolve = null;
        }
      }
    }
  });

  logger.info('DirectCLI: setting up stderr handler');
  child.stderr.on('data', (data) => {
    const text = data.toString().trim();
    if (text) {
      logger.warn('qodercli stderr', { text: text.substring(0, 500) });
    }
  });

  logger.info('DirectCLI: setting up close handler');
  child.on('close', (code, signal) => {
    logger.info('qodercli process exited', { code, signal, remainingBuffer: lineBuffer.substring(0, 200), linesQueued: lineQueue.length });
    // Process any remaining buffer
    if (lineBuffer.trim()) {
      lineQueue.push(lineBuffer.trim());
      lineBuffer = '';
      if (lineResolve) {
        lineResolve();
        lineResolve = null;
      }
    }
    streamEnded = true;
    if (lineResolve) {
      lineResolve();
      lineResolve = null;
    }
  });

  logger.info('DirectCLI: setting up error handler');
  child.on('error', (err) => {
    logger.error('qodercli spawn error', { error: err.message });
    streamError = err;
    streamEnded = true;
    if (lineResolve) {
      lineResolve();
      lineResolve = null;
    }
  });

  // Async iterator: yield parsed JSON messages
  logger.info('DirectCLI: entering main loop', { lineQueueLen: lineQueue.length, streamEnded, streamError: streamError ? streamError.message : null });
  try {
    while (true) {
      // Wait for a line to be available
      while (lineQueue.length === 0 && !streamEnded && !streamError) {
        logger.info('DirectCLI: waiting for data...');
        await new Promise((resolve) => { lineResolve = resolve; });
        logger.info('DirectCLI: promise resolved', { lineQueueLen: lineQueue.length, streamEnded });
      }

      if (streamError) {
        logger.error('DirectCLI: stream error', { error: streamError.message });
        throw streamError;
      }

      if (lineQueue.length === 0 && streamEnded) {
        logger.info('DirectCLI: stream ended with no more lines');
        break;
      }

      const line = lineQueue.shift();
      if (!line) continue;

      // Parse JSON line
      let parsed;
      try {
        parsed = JSON.parse(line);
      } catch (parseErr) {
        logger.warn('Failed to parse qodercli output line', { line: line.substring(0, 200) });
        continue;
      }

      // Yield the parsed message in SDK-compatible format
      // qodercli stream-json output types:
      //   {"type":"system","subtype":"init",...}
      //   {"type":"assistant","message":{"content":[{"type":"text","text":"..."}],...},...}
      //   {"type":"result","subtype":"success","duration_ms":...,"usage":{...}}
      yield parsed;

      // If this is a result message, we're done
      if (parsed.type === 'result') {
        break;
      }
    }
  } finally {
    abortController.signal.removeEventListener('abort', onAbort);
    try { child.kill(); } catch {}
  }
}

// Create Express app
const app = express();

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// API key authentication middleware
function apiKeyAuth(req, res, next) {
  if (!config.apiKey) return next();

  const authHeader = req.headers['authorization'];
  const bearerToken = authHeader && authHeader.startsWith('Bearer ')
    ? authHeader.substring(7)
    : null;

  const queryKey = req.query['api_key'];

  if (bearerToken === config.apiKey || queryKey === config.apiKey) {
    return next();
  }

  res.status(401).json({
    error: {
      message: 'Invalid API key',
      type: 'invalid_request_error',
      code: 'invalid_api_key',
    },
  });
}

// Apply API key auth to /v1/ routes
app.use('/v1/', apiKeyAuth);

// ==================== Message Logs API ====================

/**
 * GET /api/logs - List recent message logs
 */
app.get('/api/logs', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);
  const offset = parseInt(req.query.offset) || 0;
  const result = messageLogger.getLogs(limit, offset);
  res.json(result);
});

/**
 * GET /api/logs/:id - Get a specific log entry
 */
app.get('/api/logs/:id', (req, res) => {
  const log = messageLogger.getLog(req.params.id);
  if (!log) {
    return res.status(404).json({
      error: {
        message: 'Log entry not found',
        type: 'not_found',
      },
    });
  }
  res.json(log);
});

/**
 * DELETE /api/logs - Clear all logs
 */
app.delete('/api/logs', (req, res) => {
  messageLogger.clearLogs();
  res.json({ message: 'All logs cleared' });
});

// ==================== Endpoints ====================

/**
 * GET /health - Health check
 */
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'qoderwork-api-gateway',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
  });
});

/**
 * GET /status - QoderWork login status and available models
 */
app.get('/status', async (req, res) => {
  try {
    // First try direct CLI status check (most reliable, bypasses SDK issues)
    let loginStatus = null;
    try {
      loginStatus = await auth.getStatusFromCli();
      loginStatus.source = 'cli-direct';
    } catch (cliErr) {
      logger.warn('Direct CLI status check failed, falling back to auth module', { error: cliErr.message });
    }

    // If direct CLI didn't work, fall back to auth module
    if (!loginStatus || (!loginStatus.loggedIn && !loginStatus.raw)) {
      loginStatus = await auth.checkLoginStatus();
    }

    // Check if Named Pipe is available (for transport mode info)
    let pipeAvailable = false;
    if (sdkConfigured && sdk) {
      try {
        const pipeEndpoint = config.chatPipe || '//./pipe/qoderwork-chat';
        pipeAvailable = await sdk.isConnectable({
          chatEndpoint: pipeEndpoint,
          timeoutMs: 2000,
          retries: 1,
        });
      } catch {}
    }

    res.json({
      service: 'qoderwork-api-gateway',
      login: loginStatus,
      models: Object.keys(config.models),
      sdkConfigured,
      transport: {
        mode: config.transportMode,
        pipeAvailable,
        activeTransport: pipeAvailable ? 'pipe' : 'direct-cli',
      },
      config: {
        storageDir: config.qoderwork.storageDir,
        resourceDir: config.qoderwork.resourceDir,
        cliPath: config.qoderwork.cliPath,
        integrationMode: config.integrationMode,
      },
    });
  } catch (err) {
    logger.error('Status check failed', { error: err.message });
    res.status(500).json({
      error: {
        message: 'Failed to check status',
        type: 'internal_error',
      },
    });
  }
});

/**
 * GET /v1/models - List available models
 */
app.get('/v1/models', (req, res) => {
  res.json(converter.createModelListResponse());
});

/**
 * GET /v1/models/:model - Get model info
 */
app.get('/v1/models/:model', (req, res) => {
  const modelInfo = converter.createModelInfoResponse(req.params.model);
  if (!modelInfo) {
    return res.status(404).json({
      error: {
        message: `Model '${req.params.model}' not found`,
        type: 'invalid_request_error',
        code: 'model_not_found',
      },
    });
  }
  res.json(modelInfo);
});

/**
 * POST /v1/chat/completions - Chat completion endpoint
 */
app.post('/v1/chat/completions', async (req, res) => {
  const startTime = Date.now();
  const requestId = converter.generateCompletionId();
  let msgLogId = null;

  try {
    // Ensure SDK is initialized
    initSDK();

    const { model, messages, stream, max_tokens, temperature, max_turns } = req.body;

    // Validate request
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({
        error: {
          message: 'messages is required and must be a non-empty array',
          type: 'invalid_request_error',
        },
      });
    }

    // Resolve model name
    const modelName = model || config.defaultModel;
    if (!config.models[modelName]) {
      logger.warn('Unknown model requested, using default', { requested: modelName, default: config.defaultModel });
    }
    const resolvedModel = config.models[modelName] ? modelName : config.defaultModel;

    // Convert OpenAI messages to SDK prompt
    const prompt = converter.openaiMessagesToPrompt(messages);
    if (!prompt.trim()) {
      return res.status(400).json({
        error: {
          message: 'No valid content in messages',
          type: 'invalid_request_error',
        },
      });
    }

    logger.info('Chat completion request', {
      requestId,
      model: resolvedModel,
      stream: !!stream,
      messageCount: messages.length,
      promptLength: prompt.length,
    });

    // Start message logging
    msgLogId = messageLogger.startLog({
      requestId,
      model: resolvedModel,
      messages,
      stream: !!stream,
      max_tokens: max_tokens || 0,
      temperature: temperature || 0,
      max_turns: max_turns || config.defaultMaxTurns,
      prompt,
    });

    // Create abort controller
    const abortController = new AbortController();

    // Set up timeout
    const timeoutId = setTimeout(() => {
      abortController.abort();
      logger.warn('Request timed out', { requestId, timeout: config.requestTimeout });
    }, config.requestTimeout);

    // Clean up on client disconnect
    // Use res.on('close') instead of req.on('close') because req 'close' fires
    // when the request body stream ends (after express.json() reads it),
    // NOT when the client disconnects. res 'close' fires when the response
    // is closed before finishing (i.e., actual client disconnect).
    res.on('close', () => {
      if (!res.writableEnded) {
        logger.info('Client disconnected, aborting request', { requestId });
        abortController.abort();
      }
      clearTimeout(timeoutId);
    });

    // Build SDK query options
    const queryOptions = {
      model: resolvedModel,
      cwd: config.defaultCwd,
      permissionMode: 'bypassPermissions',
      allowDangerouslySkipPermissions: true,
      maxTurns: max_turns || config.defaultMaxTurns,
      abortController,
      includePartialMessages: !!stream,
    };

    // Determine transport mode
    let transport = null;
    let useDirectCLI = false;
    const transportMode = config.transportMode; // 'auto', 'pipe', 'subprocess'

    if (transportMode === 'pipe' || transportMode === 'auto') {
      // Try TcpTransport via Named Pipe (connect to running QoderWork)
      try {
        const pipeEndpoint = config.chatPipe || '//./pipe/qoderwork-chat';
        const connectable = await sdk.isConnectable({
          chatEndpoint: pipeEndpoint,
          timeoutMs: 2000,
          retries: 1,
        });
        if (connectable) {
          logger.info('Named Pipe is connectable, using TcpTransport', { endpoint: pipeEndpoint });
          transport = new sdk.TcpTransport({
            prompt: prompt,
            options: queryOptions,
            chatEndpoint: pipeEndpoint,
          });
        } else {
          logger.info('Named Pipe not connectable, falling back to direct CLI', { endpoint: pipeEndpoint });
        }
      } catch (pipeErr) {
        logger.warn('TcpTransport check failed, falling back to direct CLI', { error: pipeErr.message });
        transport = null;
      }
    }

    if (!transport) {
      // Use direct CLI transport instead of SDK's SubprocessTransport
      // The SDK's configure() with integrationMode 'qoder_work' interferes
      // with subprocess communication and returns empty responses.
      logger.info('Using direct CLI transport (qodercli.exe via spawn)');
      useDirectCLI = true;
    }

    // Execute query - either via SDK (with TcpTransport) or direct CLI
    let queryResult;
    if (useDirectCLI) {
      queryResult = queryViaDirectCLI(prompt, {
        model: resolvedModel,
        maxTurns: max_turns || config.defaultMaxTurns,
        cwd: config.defaultCwd,
        abortController,
      });
    } else {
      const queryParams = {
        prompt: prompt,
        options: queryOptions,
      };
      if (transport) {
        queryParams.transport = transport;
      }
      queryResult = sdk.query(queryParams);
    }

    if (stream) {
      // Streaming response
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');

      // Send initial role chunk
      const roleChunk = {
        id: requestId,
        object: 'chat.completion.chunk',
        created: Math.floor(Date.now() / 1000),
        model: resolvedModel,
        choices: [{
          index: 0,
          delta: { role: 'assistant', content: '' },
          finish_reason: null,
        }],
      };
      res.write(converter.formatSSE(roleChunk));

      let fullText = '';
      let fullThinking = '';
      let toolUseList = [];
      let resultMsg = null;

      try {
        for await (const msg of queryResult) {
          if (abortController.signal.aborted) break;

          // Log every SDK message
          messageLogger.addSdkMessage(msgLogId, msg);

          if (msg.type === 'stream_event') {
            // Handle streaming partial messages (from SDK TcpTransport)
            const chunk = converter.sdkStreamEventToOpenAIChunk(msg, resolvedModel, requestId);
            if (chunk) {
              // Detect content type and log accordingly
              const qoderType = chunk._qoder_type || 'text';
              const deltaContent = chunk.choices && chunk.choices[0] && chunk.choices[0].delta && chunk.choices[0].delta.content;

              if (deltaContent) {
                if (qoderType === 'thinking') {
                  fullThinking += deltaContent;
                  messageLogger.addThinking(msgLogId, deltaContent);
                } else if (qoderType === 'tool_use') {
                  // Tool use content is logged via addToolUse from content blocks
                } else {
                  // Regular text - skip thinking markers in accumulation
                  if (!deltaContent.startsWith('<<thinking>>') && !deltaContent.startsWith('<</thinking>>')) {
                    fullText += deltaContent;
                  }
                  messageLogger.addContent(msgLogId, deltaContent);
                }
              }

              // Log tool_use from content blocks
              if (qoderType === 'tool_use' && chunk._qoder_tool) {
                toolUseList.push(chunk._qoder_tool);
                messageLogger.addToolUse(msgLogId, chunk._qoder_tool);
              }

              res.write(converter.formatSSE(chunk));
            }
          } else if (msg.type === 'assistant') {
            // Handle complete assistant messages (from direct CLI or SDK)
            const text = converter.extractTextFromAssistantMessage(msg);
            const thinking = converter.extractThinkingFromAssistantMessage(msg);
            if (thinking) {
              fullThinking += thinking;
              messageLogger.addThinking(msgLogId, thinking);
            }

            if (useDirectCLI) {
              // Direct CLI mode: assistant messages may arrive incrementally.
              // Calculate delta text (new content since last sent) and stream it.
              if (text && text.length > fullText.length) {
                const deltaText = text.substring(fullText.length);
                fullText = text;
                messageLogger.addContent(msgLogId, deltaText);

                const textChunk = {
                  id: requestId,
                  object: 'chat.completion.chunk',
                  created: Math.floor(Date.now() / 1000),
                  model: resolvedModel,
                  choices: [{
                    index: 0,
                    delta: { content: deltaText },
                    finish_reason: null,
                  }],
                };
                res.write(converter.formatSSE(textChunk));
              }
            } else {
              // SDK mode: send full text if we haven't sent any yet
              if (text && !fullText) {
                fullText = text;
                messageLogger.addContent(msgLogId, text);
                const textChunk = {
                  id: requestId,
                  object: 'chat.completion.chunk',
                  created: Math.floor(Date.now() / 1000),
                  model: resolvedModel,
                  choices: [{
                    index: 0,
                    delta: { content: text },
                    finish_reason: null,
                  }],
                };
                res.write(converter.formatSSE(textChunk));
              }
            }

            // Extract tool_use from assistant message content blocks
            if (msg.message && msg.message.content) {
              for (const block of msg.message.content) {
                if (block.type === 'tool_use') {
                  const toolInfo = { id: block.id, type: block.type, name: block.name, input: block.input };
                  toolUseList.push(toolInfo);
                  messageLogger.addToolUse(msgLogId, toolInfo);
                }
              }
            }
          } else if (msg.type === 'result') {
            resultMsg = msg;
            // For direct CLI mode, the actual text content may be in result.result
            // if assistant messages only contained thinking content
            if (useDirectCLI && msg.result && !fullText.trim()) {
              fullText = msg.result;
              messageLogger.addContent(msgLogId, msg.result);
            }
          }
          // Skip system, user, and other message types
        }
      } catch (streamErr) {
        if (streamErr.name === 'AbortError' || abortController.signal.aborted) {
          logger.info('Stream aborted', { requestId });
          messageLogger.errorLog(msgLogId, 'Stream aborted');
        } else {
          logger.error('Stream error', { requestId, error: streamErr.message });
          messageLogger.errorLog(msgLogId, streamErr.message);
          // Try to send error as a chunk
          const errorChunk = {
            id: requestId,
            object: 'chat.completion.chunk',
            created: Math.floor(Date.now() / 1000),
            model: resolvedModel,
            choices: [{
              index: 0,
              delta: { content: `\n\n[Error: ${streamErr.message}]` },
              finish_reason: null,
            }],
          };
          try { res.write(converter.formatSSE(errorChunk)); } catch {}
        }
      }

      // Send finish chunk
      const finishChunk = {
        id: requestId,
        object: 'chat.completion.chunk',
        created: Math.floor(Date.now() / 1000),
        model: resolvedModel,
        choices: [{
          index: 0,
          delta: {},
          finish_reason: 'stop',
        }],
      };
      res.write(converter.formatSSE(finishChunk));
      res.write(converter.formatSSEDone());
      res.end();

      clearTimeout(timeoutId);

      const duration = Date.now() - startTime;
      logger.info('Stream completed', {
        requestId,
        model: resolvedModel,
        duration,
        textLength: fullText.length,
      });

      // Complete message log
      const usage = resultMsg && resultMsg.usage ? {
        prompt_tokens: resultMsg.usage.input_tokens || 0,
        completion_tokens: resultMsg.usage.output_tokens || 0,
        total_tokens: (resultMsg.usage.input_tokens || 0) + (resultMsg.usage.output_tokens || 0),
      } : {};
      messageLogger.completeLog(msgLogId, {
        content: fullText,
        thinking: fullThinking,
        toolUse: toolUseList,
        finishReason: 'stop',
        usage,
      });

    } else {
      // Non-streaming response
      let fullText = '';
      let fullThinking = '';
      let toolUseList = [];
      let resultMsg = null;

      logger.info('Entering non-streaming for-await loop', { useDirectCLI, queryResultType: typeof queryResult });
      try {
        for await (const msg of queryResult) {
          logger.info('for-await received message', { msgType: msg?.type });
          if (abortController.signal.aborted) break;

          // Log every SDK message
          messageLogger.addSdkMessage(msgLogId, msg);

          if (msg.type === 'assistant') {
            const text = converter.extractTextFromAssistantMessage(msg);
            const thinking = converter.extractThinkingFromAssistantMessage(msg);
            if (text) {
              fullText += text;
              messageLogger.addContent(msgLogId, text);
            }
            if (thinking) {
              fullThinking += thinking;
              messageLogger.addThinking(msgLogId, thinking);
            }
            // Extract tool_use from assistant message content blocks
            if (msg.message && msg.message.content) {
              for (const block of msg.message.content) {
                if (block.type === 'tool_use') {
                  const toolInfo = { id: block.id, type: block.type, name: block.name, input: block.input };
                  toolUseList.push(toolInfo);
                  messageLogger.addToolUse(msgLogId, toolInfo);
                }
              }
            }
          } else if (msg.type === 'stream_event') {
            // Accumulate text from stream events even in non-streaming mode
            const event = msg.event;
            const delta = event.delta || {};
            if (delta.text) {
              fullText += delta.text;
              messageLogger.addContent(msgLogId, delta.text);
            }
            if (delta.thinking) {
              fullThinking += delta.thinking;
              messageLogger.addThinking(msgLogId, delta.thinking);
            }
          } else if (msg.type === 'result') {
            resultMsg = msg;
            // For direct CLI mode, the actual text content may be in result.result
            // if assistant messages only contained thinking content
            if (useDirectCLI && msg.result && !fullText.trim()) {
              fullText = msg.result;
              messageLogger.addContent(msgLogId, msg.result);
            }
          }
        }
      } catch (queryErr) {
        if (queryErr.name === 'AbortError' || abortController.signal.aborted) {
          messageLogger.errorLog(msgLogId, 'Request timed out');
          return res.status(408).json({
            error: {
              message: 'Request timed out',
              type: 'timeout_error',
            },
          });
        }
        logger.error('Query error', { requestId, error: queryErr.message });
        messageLogger.errorLog(msgLogId, queryErr.message);
        return res.status(500).json({
          error: {
            message: queryErr.message || 'Internal server error',
            type: 'api_error',
          },
        });
      }

      clearTimeout(timeoutId);

      // If no content was generated, check if it might be a login issue
      if (!fullText.trim()) {
        logger.warn('Empty response received - user may not be logged in', { requestId });
      }

      // Build completion response
      const completion = converter.sdkResultToOpenAICompletion(
        resultMsg,
        fullText,
        resolvedModel,
        requestId
      );

      const duration = Date.now() - startTime;
      logger.info('Completion finished', {
        requestId,
        model: resolvedModel,
        duration,
        textLength: fullText.length,
        usage: completion.usage,
      });

      // Complete message log
      const usage = resultMsg && resultMsg.usage ? {
        prompt_tokens: resultMsg.usage.input_tokens || 0,
        completion_tokens: resultMsg.usage.output_tokens || 0,
        total_tokens: (resultMsg.usage.input_tokens || 0) + (resultMsg.usage.output_tokens || 0),
      } : completion.usage || {};
      messageLogger.completeLog(msgLogId, {
        content: fullText,
        thinking: fullThinking,
        toolUse: toolUseList,
        finishReason: 'stop',
        usage,
      });

      res.json(completion);
    }

  } catch (err) {
    logger.error('Unhandled error in chat completion', {
      requestId,
      error: err.message,
      stack: err.stack,
    });

    // Log error to message logger
    if (msgLogId) {
      messageLogger.errorLog(msgLogId, err.message);
    }

    if (!res.headersSent) {
      res.status(500).json({
        error: {
          message: err.message || 'Internal server error',
          type: 'internal_error',
        },
      });
    } else {
      // If headers already sent (streaming), try to end the stream
      try {
        res.write(converter.formatSSEDone());
        res.end();
      } catch {}
    }
  }
});

// ==================== Start Server ====================

function startServer() {
  // Initialize SDK
  try {
    initSDK();
  } catch (err) {
    logger.error('Failed to initialize SDK on startup - server will start but queries will fail', {
      error: err.message,
    });
  }

  const port = config.port;
  app.listen(port, () => {
    logger.info(`QoderWork API Gateway started`, {
      port,
      models: Object.keys(config.models),
      defaultModel: config.defaultModel,
      apiKey: config.apiKey ? 'configured' : 'none',
      storageDir: config.qoderwork.storageDir,
      resourceDir: config.qoderwork.resourceDir,
      cliPath: config.qoderwork.cliPath,
    });
    console.log('');
    console.log(`  QoderWork API Gateway`);
    console.log(`  =====================`);
    console.log(`  Server:  http://localhost:${port}`);
    console.log(`  Models:  http://localhost:${port}/v1/models`);
    console.log(`  Chat:    http://localhost:${port}/v1/chat/completions`);
    console.log(`  Health:  http://localhost:${port}/health`);
    console.log(`  Status:  http://localhost:${port}/status`);
    console.log(`  Logs:    http://localhost:${port}/api/logs`);
    console.log(`  API Key: ${config.apiKey ? 'configured' : 'none (open access)'}`);
    console.log('');
  });
}

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception', { error: err.message, stack: err.stack });
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled rejection', { reason: String(reason) });
});

// Start the server
startServer();
