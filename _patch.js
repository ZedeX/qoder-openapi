const fs = require('fs');
const path = require('path');
const basePath = path.join(__dirname);

// ================== Patch converter.js =================
const converterPath = path.join(basePath, 'converter.js');
let converter = fs.readFileSync(converterPath, 'utf8');

// 1. Add extractToolUseFromAssistantMessage and extractToolResultFromUserMessage
const newFunctions = `
/**
 * Extract tool_use blocks from SDK assistant message
 * Returns array of { id, name, input } objects
 */
function extractToolUseFromAssistantMessage(msg) {
  if (!msg || msg.type !== 'assistant' || !msg.message || !msg.message.content) {
    return [];
  }
  const toolUses = [];
  for (const block of msg.message.content) {
    if (block.type === 'tool_use') {
      toolUses.push({ id: block.id || '', name: block.name || '', input: block.input || {} });
    }
  }
  return toolUses;
}

/**
 * Extract tool_result blocks from user message (tool results)
 * Returns array of { tool_use_id, content, is_error } objects
 */
function extractToolResultFromUserMessage(msg) {
  if (!msg || msg.type !== 'user' || !msg.message || !msg.message.content) {
    return [];
  }
  const results = [];
  for (const block of msg.message.content) {
    if (block.type === 'tool_result') {
      let contentText = '';
      if (typeof block.content === 'string') {
        contentText = block.content;
      } else if (Array.isArray(block.content)) {
        contentText = block.content.filter(c => c.type === 'text').map(c => c.text).join('\n');
      }
      if (!contentText && block.tool_use_result && block.tool_use_result.stdout) {
        contentText = block.tool_use_result.stdout;
      }
      results.push({ tool_use_id: block.tool_use_id || '', content: contentText, is_error: block.is_error || false });
    }
  }
  return results;
}

`;

const genIdMarker = '/**\n * Generate a completion ID\n */';
if (!converter.includes('extractToolUseFromAssistantMessage')) {
  converter = converter.replace(genIdMarker, newFunctions + genIdMarker);
  console.log('converter.js: Added new functions');
} else {
  console.log('converter.js: Functions already exist');
}

// 2. Update module.exports
const oldExports = `module.exports = {
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
};`;

const newExports = `module.exports = {
  openaiMessagesToPrompt,
  sdkStreamEventToOpenAIChunk,
  sdkResultToOpenAICompletion,
  extractTextFromAssistantMessage,
  extractThinkingFromAssistantMessage,
  extractToolUseFromAssistantMessage,
  extractToolResultFromUserMessage,
  generateCompletionId,
  createModelListResponse,
  createModelInfoResponse,
  formatSSE,
  formatSSEDone,
}`;

if (!converter.includes('extractToolUseFromAssistantMessage,')) {
  converter = converter.replace(oldExports, newExports);
  console.log('converter.js: Updated exports');
} else {
  console.log('converter.js: Exports already updated');
}

// 3. Fix thinking content - remove <<thinking>> markers
converter = converter.replace("content = `<<thinking>>${delta.thinking}<</thinking>>`;", "content = delta.thinking;");
converter = converter.replace("content = `<<thinking>>${contentBlock.thinking}<</thinking>>`;", "content = contentBlock.thinking;");
console.log('converter.js: Fixed thinking markers');

fs.writeFileSync(converterPath, converter, 'utf8');
console.log('converter.js patched');

// ================== Patch server.js =================
const serverPath = path.join(basePath, 'server.js');
let server = fs.readFileSync(serverPath, 'utf8');

// 1. Add CHP=65001 to cleanEnv
if (!server.includes("cleanEnv.CHCP = '65001'")) {
  server = server.replace("delete cleanEnv.QODER_ENABLE_SDK_FILE_CHECKPOINTING;", "delete cleanEnv.QODER_ENABLE_SDK_FILE_CHECKPOINTING;\n  cleanEnv.CHCP = '65001';");
  console.log('server.js: Added CHP=65001');
} else {
  console.log('server.js: CHP already set');
}

// 2. Fix UTF-8: data.toString() -> data.toString('utf-8')
if (!server.includes("data.toString('utf-8')")) {
  server = server.replace("child.stdout.on('data', (data) => {\n    const rawText = data.toString();", "child.stdout.on('data', (data) => {\n    const rawText = data.toString('utf-8');");
  server = server.replace("child.stderr.on('data', (data) => {\n    const text = data.toString().trim();", "child.stderr.on('data', (data) => {\n    const text = data.toString('utf-8').trim();");
  console.log('server.js: Fixed UTF-8 encoding');
} else {
  console.log('server.js: UTF-8 already fixed');
}

// 3. Add thinking SSE chunk in streaming handler
if (!server.includes("_qoder_type: 'thinking'")) {
  const oldThinking = 'const thinking = converter.extractThinkingFromAssistantMessage(msg);\n            if (thinking) {\n              fullThinking += thinking;\n              messageLogger.addThinking(msgLogId, thinking);\n            }';
  const newThinking = 'const thinking = converter.extractThinkingFromAssistantMessage(msg);\n            if (thinking) {\n              fullThinking += thinking;\n              messageLogger.addThinking(msgLogId, thinking);\n\n              // Send thinking as SSE chunk\n              const thinkingChunk = {\n                id: requestId,\n                object: \'chat.completion.chunk\',\n                created: Math.floor(Date.now() / 1000),\n                model: resolvedModel,\n                choices: [{\n                  index: 0,\n                  delta: { content: thinking },\n                  finish_reason: null,\n                }],\n                _qoder_type: \'thinking\',\n              };\n              res.write(converter.formatSSE(thinkingChunk));\n            }';
  server = server.replace(oldThinking, newThinking);
  console.log('server.js: Added thinking SSE chunk');
} else {
  console.log('server.js: Thinking SSE chunk already exists');
}

// 4. Add tool_use SSE chunk in streaming handler
if (!server.includes("_qoder_type: 'tool_use'")) {
  const oldToolUse = '            // Extract tool_use from assistant message content blocks\n            if (msg.message && msg.message.content) {\n              for (const block of msg.message.content) {\n                if (block.type === \'tool_use\') {\n                  const toolInfo = { id: block.id, type: block.type, name: block.name, input: block.input };\n                  toolUseList.push(toolInfo);\n                  messageLogger.addToolUse(msgLogId, toolInfo);\n                }\n              }\n            }';
  const newToolUse = '            // Extract and send tool_use from assistant message content blocks\n            if (msg.message && msg.message.content) {\n              for (const block of msg.message.content) {\n                if (block.type === \'tool_use\') {n                  const toolInfo = { id: block.id, type: block.type, name: block.name, input: block.input };\n                  toolUseList.push(toolInfo);\n                  messageLogger.addToolUse(msgLogId, toolInfo);\n\n                  // Send tool_use as SSE chunk\n                  const toolUseChunk = {\n                    id: requestId,\n                    object: \'chat.completion.chunk\',\n                    created: Math.floor(Date.now() / 1000),\n                    model: resolvedModel,\n                    choices: [{\n                      index: 0,\n                      delta: {},\n                      finish_reason: null,\n                    }],\n                    _qoder_type: \'tool_use\',\n                    _qoder_tool_name: block.name || \'\',\n                    _qoder_tool_input: block.input || {},\n                    _qoder_tool_id: block.id || \'\',\n                  };\n                  res.write(converter.formatSSE(toolUseChunk));\n                }\n              }\n            }';
  server = server.replace(oldToolUse, newToolUse);
  console.log('server.js: Added tool_use SSE chunk');
} else {
  console.log('server.js: tool_use SSE chunk already exists');
}

// 5. Add tool_result handling in streaming mode
if (!server.includes("_qoder_type: 'tool_result'")) {
  const skipComment = '          // Skip system, user, and other message types';
  const toolResultHandler = '} else if (msg.type === \'user\') {\n            // Handle tool_result from user messages\n            const toolResults = converter.extractToolResultFromUserMessage(msg);\n            for (const tr of toolResults) {\n              const toolResultChunk = {\n                id: requestId,\n                object: \'chat.completion.chunk\',\n                created: Math.floor(Date.now() / 1000),\n                model: resolvedModel,\n                choices: [{\n                  index: 0,\n                  delta: { content: tr.content },\n                  finish_reason: null,\n                }],\n                _qoder_type: \'tool_result\',\n                _qoder_tool_id: tr.tool_use_id,\n                _qoder_is_error: tr.is_error,\n              };\n              res.write(converter.formatSSE(toolResultChunk));\n            }\n          ';
  server = server.replace(skipComment, toolResultHandler + skipComment);
  console.log('server.js: Added tool_result handler');
} else {
  console.log('server.js: tool_result handler already exists');
}

fs.writeFileSync(serverPath, server, 'utf8');
console.log('server.js patched');
console.log('\nAll patches applied successfully!');