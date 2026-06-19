const express = require('express');
const cors = require('cors');
const path = require('path');
const config = require('./config');
const logger = require('./logger');
const auth = require('./auth');
const converter = require('./converter');

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

// Create Express app
const app = express();

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));

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
    const loginStatus = await auth.checkLoginStatus();
    res.json({
      service: 'qoderwork-api-gateway',
      login: loginStatus,
      models: Object.keys(config.models),
      sdkConfigured,
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

    // Create abort controller
    const abortController = new AbortController();

    // Set up timeout
    const timeoutId = setTimeout(() => {
      abortController.abort();
      logger.warn('Request timed out', { requestId, timeout: config.requestTimeout });
    }, config.requestTimeout);

    // Clean up on client disconnect
    req.on('close', () => {
      abortController.abort();
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
          logger.info('Named Pipe not connectable, falling back to subprocess', { endpoint: pipeEndpoint });
        }
      } catch (pipeErr) {
        logger.warn('TcpTransport check failed, falling back to subprocess', { error: pipeErr.message });
        transport = null;
      }
    }

    if (!transport) {
      // Fallback to SubprocessTransport (spawn qodercli.exe)
      logger.info('Using SubprocessTransport (qodercli.exe)');
      queryOptions.pathToQoderCLIExecutable = config.qoderwork.cliPath;
      queryOptions.storageDir = config.qoderwork.storageDir;
      queryOptions.resourceDir = config.qoderwork.resourceDir;
      queryOptions.integrationMode = config.integrationMode;
    }

    // Execute SDK query
    const queryParams = {
      prompt: prompt,
      options: queryOptions,
    };
    if (transport) {
      queryParams.transport = transport;
    }

    const queryResult = sdk.query(queryParams);

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
      let resultMsg = null;

      try {
        for await (const msg of queryResult) {
          if (abortController.signal.aborted) break;

          if (msg.type === 'stream_event') {
            // Handle streaming partial messages
            const chunk = converter.sdkStreamEventToOpenAIChunk(msg, resolvedModel, requestId);
            if (chunk) {
              // Accumulate text content (not thinking)
              if (chunk.choices && chunk.choices[0] && chunk.choices[0].delta && chunk.choices[0].delta.content) {
                const content = chunk.choices[0].delta.content;
                // Skip thinking markers in accumulation
                if (!content.startsWith('<<thinking>>') && !content.startsWith('<</thinking>>')) {
                  fullText += content;
                }
              }
              res.write(converter.formatSSE(chunk));
            }
          } else if (msg.type === 'assistant') {
            // Handle complete assistant messages
            const text = converter.extractTextFromAssistantMessage(msg);
            if (text && !fullText) {
              fullText = text;
              // If we haven't sent any streaming content yet, send the full text
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
          } else if (msg.type === 'result') {
            resultMsg = msg;
          }
          // Skip system, user, and other message types
        }
      } catch (streamErr) {
        if (streamErr.name === 'AbortError' || abortController.signal.aborted) {
          logger.info('Stream aborted', { requestId });
        } else {
          logger.error('Stream error', { requestId, error: streamErr.message });
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

    } else {
      // Non-streaming response
      let fullText = '';
      let resultMsg = null;

      try {
        for await (const msg of queryResult) {
          if (abortController.signal.aborted) break;

          if (msg.type === 'assistant') {
            const text = converter.extractTextFromAssistantMessage(msg);
            if (text) {
              fullText += text;
            }
          } else if (msg.type === 'stream_event') {
            // Accumulate text from stream events even in non-streaming mode
            const event = msg.event;
            const delta = event.delta || {};
            if (delta.text) {
              fullText += delta.text;
            }
          } else if (msg.type === 'result') {
            resultMsg = msg;
          }
        }
      } catch (queryErr) {
        if (queryErr.name === 'AbortError' || abortController.signal.aborted) {
          return res.status(408).json({
            error: {
              message: 'Request timed out',
              type: 'timeout_error',
            },
          });
        }
        logger.error('Query error', { requestId, error: queryErr.message });
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

      res.json(completion);
    }

  } catch (err) {
    logger.error('Unhandled error in chat completion', {
      requestId,
      error: err.message,
      stack: err.stack,
    });

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
