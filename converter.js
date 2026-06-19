const { v4: uuidv4 } = require('uuid');
const config = require('./config');

/**
 * Convert OpenAI messages array to a prompt string for the SDK
 *
 * OpenAI format: [{ role: "system"|"user"|"assistant", content: "..." }]
 * SDK format: single prompt string
 */
function openaiMessagesToPrompt(messages) {
  if (!Array.isArray(messages) || messages.length === 0) {
    return '';
  }

  const parts = [];
  for (const msg of messages) {
    const role = msg.role || 'user';
    let content = '';

    if (typeof msg.content === 'string') {
      content = msg.content;
    } else if (Array.isArray(msg.content)) {
      // Handle multi-part content (e.g., text + images)
      const textParts = msg.content
        .filter(part => part.type === 'text')
        .map(part => part.text);
      content = textParts.join('\n');
    }

    if (!content) continue;

    switch (role) {
      case 'system':
        parts.push(`[System]\n${content}`);
        break;
      case 'user':
        parts.push(`[User]\n${content}`);
        break;
      case 'assistant':
        parts.push(`[Assistant]\n${content}`);
        break;
      default:
        parts.push(`[${role}]\n${content}`);
    }
  }

  return parts.join('\n\n');
}

/**
 * Create an OpenAI-compatible streaming chunk from SDK stream_event
 */
function sdkStreamEventToOpenAIChunk(msg, model, completionId) {
  if (!msg || msg.type !== 'stream_event' || !msg.event) {
    return null;
  }

  const event = msg.event;
  const delta = event.delta || {};
  const contentBlock = event.content_block || {};

  let content = null;
  let qoderType = 'text';
  let qoderTool = null;

  // Handle text delta
  if (delta.text) {
    content = delta.text;
    qoderType = 'text';
  }
  // Handle text content block start
  else if (contentBlock.type === 'text' && contentBlock.text) {
    content = contentBlock.text;
    qoderType = 'text';
  }
  // Handle thinking content - include as special format
  else if (delta.thinking) {
    content = `<<thinking>>${delta.thinking}<</thinking>>`;
    qoderType = 'thinking';
  }
  else if (contentBlock.type === 'thinking' && contentBlock.thinking) {
    content = `<<thinking>>${contentBlock.thinking}<</thinking>>`;
    qoderType = 'thinking';
  }
  // Handle tool_use content block start
  else if (contentBlock.type === 'tool_use') {
    qoderType = 'tool_use';
    qoderTool = {
      id: contentBlock.id || '',
      type: 'tool_use',
      name: contentBlock.name || '',
      input: {},
    };
    content = null;
  }
  // Handle tool_use input delta
  else if (delta.partial_json) {
    qoderType = 'tool_use';
    content = null;
  }

  if (content === null && qoderType !== 'tool_use') {
    return null;
  }

  const chunk = {
    id: completionId,
    object: 'chat.completion.chunk',
    created: Math.floor(Date.now() / 1000),
    model: model,
    choices: [{
      index: 0,
      delta: content !== null ? {
        content: content,
      } : {},
      finish_reason: null,
    }],
  };

  // Add custom _qoder_type field for all chunks
  chunk._qoder_type = qoderType;

  // Add _qoder_tool field for tool_use chunks
  if (qoderTool) {
    chunk._qoder_tool = qoderTool;
  }

  return chunk;
}

/**
 * Create an OpenAI-compatible completion from SDK result message
 */
function sdkResultToOpenAICompletion(resultMsg, fullText, model, completionId) {
  const usage = {
    prompt_tokens: 0,
    completion_tokens: 0,
    total_tokens: 0,
  };

  if (resultMsg && resultMsg.usage) {
    usage.prompt_tokens = resultMsg.usage.input_tokens || 0;
    usage.completion_tokens = resultMsg.usage.output_tokens || 0;
    usage.total_tokens = usage.prompt_tokens + usage.completion_tokens;
  }

  // If we have no text from streaming, try to get it from the result
  let content = fullText || '';
  if (!content && resultMsg && resultMsg.result) {
    content = resultMsg.result;
  }

  const finishReason = resultMsg && resultMsg.subtype === 'success' ? 'stop' : 'stop';

  return {
    id: completionId,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: model,
    choices: [{
      index: 0,
      message: {
        role: 'assistant',
        content: content,
      },
      finish_reason: finishReason,
    }],
    usage: usage,
  };
}

/**
 * Extract text content from SDK assistant message
 */
function extractTextFromAssistantMessage(msg) {
  if (!msg || msg.type !== 'assistant' || !msg.message || !msg.message.content) {
    return '';
  }

  const textParts = [];
  for (const block of msg.message.content) {
    if (block.type === 'text' && block.text) {
      textParts.push(block.text);
    }
    // Skip tool_use and thinking content for the main response
  }

  return textParts.join('\n');
}

/**
 * Extract thinking content from SDK assistant message
 */
function extractThinkingFromAssistantMessage(msg) {
  if (!msg || msg.type !== 'assistant' || !msg.message || !msg.message.content) {
    return '';
  }

  const thinkingParts = [];
  for (const block of msg.message.content) {
    if (block.type === 'thinking' && block.thinking) {
      thinkingParts.push(block.thinking);
    }
  }

  return thinkingParts.join('\n');
}

/**
 * Generate a completion ID
 */
function generateCompletionId() {
  return 'chatcmpl-' + uuidv4().replace(/-/g, '').substring(0, 24);
}

/**
 * Create an OpenAI-compatible model list response
 */
function createModelListResponse() {
  const models = Object.values(config.models);
  return {
    object: 'list',
    data: models.map(m => ({
      id: m.id,
      object: 'model',
      created: Math.floor(Date.now() / 1000),
      owned_by: m.owned_by,
    })),
  };
}

/**
 * Create an OpenAI-compatible model info response
 */
function createModelInfoResponse(modelId) {
  const model = config.models[modelId];
  if (!model) return null;

  return {
    id: model.id,
    object: 'model',
    created: Math.floor(Date.now() / 1000),
    owned_by: model.owned_by,
    permission: [{
      id: 'modelperm-' + uuidv4().replace(/-/g, '').substring(0, 24),
      object: 'model_permission',
      created: Math.floor(Date.now() / 1000),
      allow_create_engine: false,
      allow_sampling: true,
      allow_logprobs: false,
      allow_search_indices: false,
      allow_view: true,
      allow_fine_tuning: false,
      organization: '*',
      group: null,
      is_blocking: false,
    }],
  };
}

/**
 * Create SSE data line
 */
function formatSSE(data) {
  return `data: ${JSON.stringify(data)}\n\n`;
}

/**
 * Create SSE done signal
 */
function formatSSEDone() {
  return 'data: [DONE]\n\n';
}

module.exports = {
  openaiMessagesToPrompt,
  sdkStreamEventToOpenAIChunk,
  sdkResultToOpenAICompletion,
  extractTextFromAssistantMessage,
  extractThinkingFromAssistantMessage,
  generateCompletionId,
  createModelListResponse,
  createModelInfoResponse,
  formatSSE,
  formatSSEDone,
};
