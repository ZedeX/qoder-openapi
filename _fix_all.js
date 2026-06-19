const fs = require('fs');
const path = require('path');

// ===== Patch converter.js: update module.exports =====
const converterPath = path.join(__dirname, 'converter.js');
let converter = fs.readFileSync(converterPath, 'utf8');

if (!converter.includes('extractToolUseFromAssistantMessage')) {
  console.log('ERROR: extractToolUseFromAssistantMessage not found in converter.js');
  process.exit(1);
}

// Update module.exports to include new functions
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
};`;

if (converter.includes('extractToolUseFromAssistantMessage,')) {
  console.log('converter.js: exports already include new functions');
} else {
  converter = converter.replace(oldExports, newExports);
  console.log('converter.js: updated module.exports');
}

fs.writeFileSync(converterPath, converter, 'utf8');
console.log('converter.js exports patch done');

// ===== Patch server.js: add thinking SSE chunk and tool_use SSE chunk =====
const serverPath = path.join(__dirname, 'server.js');
let server = fs.readFileSync(serverPath, 'utf8');

let serverChanged = false;

// 1. Add thinking SSE chunk after thinking extraction in assistant handler
const thinkingMarker = "if (thinking) {\n              fullThinking += thinking;\n              messageLogger.addThinking(msgLogId, thinking);\n            }";
const thinkingReplacement = `if (thinking) {
              fullThinking += thinking;
              messageLogger.addThinking(msgLogId, thinking);

              // Send thinking SSE chunk
              const thinkingChunk = {
                id: requestId,
                object: 'chat.completion.chunk',
                created: Math.floor(Date.now() / 1000),
                model: resolvedModel,
                choices: [{ index: 0, delta: { content: thinking }, finish_reason: null }],
                _qoder_type: 'thinking',
              };
              res.write(converter.formatSSE(thinkingChunk));
            }`;

if (server.includes("_qoder_type: 'thinking',")) {
  console.log('server.js: thinking SSE chunk already exists');
} else if (server.includes(thinkingMarker)) {
  server = server.replace(thinkingMarker, thinkingReplacement);
  serverChanged = true;
  console.log('server.js: added thinking SSE chunk');
} else {
  console.log('server.js: WARNING - could not find thinking marker');
}

// 2. Add tool_use SSE chunk after tool_use extraction in assistant handler
const toolUseMarker = `if (block.type === 'tool_use') {\n                  const toolInfo = { id: block.id, type: block.type, name: block.name, input: block.input };\n                  toolUseList.push(toolInfo);\n                  messageLogger.addToolUse(msgLogId, toolInfo);\n                }`;
const toolUseReplacement = `if (block.type === 'tool_use') {
                  const toolInfo = { id: block.id, type: block.type, name: block.name, input: block.input };
                  toolUseList.push(toolInfo);
                  messageLogger.addToolUse(msgLogId, toolInfo);

                  // Send tool_use SSE chunk
                  const toolUseChunk = {
                    id: requestId,
                    object: 'chat.completion.chunk',
                    created: Math.floor(Date.now() / 1000),
                    model: resolvedModel,
                    choices: [{ index: 0, delta: {}, finish_reason: null }],
                    _qoder_type: 'tool_use',
                    _qoder_tool_name: block.name || '',
                    _qoder_tool_input: block.input || {},
                    _qoder_tool_id: block.id || '',
                  };
                  res.write(converter.formatSSE(toolUseChunk));
                }`;

if (server.includes("_qoder_type: 'tool_use',")) {
  console.log('server.js: tool_use SSE chunk already exists');
} else if (server.includes(toolUseMarker)) {
  server = server.replace(toolUseMarker, toolUseReplacement);
  serverChanged = true;
  console.log('server.js: added tool_use SSE chunk');
} else {
  console.log('server.js: WARNING - could not find tool_use marker');
}

// 3. Fix the broken user message handler indentation
// The current code has a misplaced closing brace and wrong indentation
const brokenUserHandler = `} else if (msg.type === 'user') {
            // Handle tool_result from user messages
            const toolResults = converter.extractToolResultFromUserMessage(msg);
            for (const tr of toolResults) {
              const toolResultChunk = {
                id: requestId,
                object: 'chat.completion.chunk',
                created: Math.floor(Date.now() / 1000),
                model: resolvedModel,
                choices: [{
                  index: 0,
                  delta: { content: tr.content },
                  finish_reason: null,
                }],
                _qoder_type: 'tool_result',
                _qoder_tool_id: tr.tool_use_id,
                _qoder_is_error: tr.is_error,
              };
              res.write(converter.formatSSE(toolResultChunk));
            }
                    // Skip system, user, and other message types
        }`;

const fixedUserHandler = `} else if (msg.type === 'user') {
            // Handle tool_result from user messages
            const toolResults = converter.extractToolResultFromUserMessage(msg);
            for (const tr of toolResults) {
              const toolResultChunk = {
                id: requestId,
                object: 'chat.completion.chunk',
                created: Math.floor(Date.now() / 1000),
                model: resolvedModel,
                choices: [{
                  index: 0,
                  delta: { content: tr.content },
                  finish_reason: null,
                }],
                _qoder_type: 'tool_result',
                _qoder_tool_id: tr.tool_use_id,
                _qoder_is_error: tr.is_error,
              };
              res.write(converter.formatSSE(toolResultChunk));
            }
          }`;

if (server.includes(brokenUserHandler)) {
  server = server.replace(brokenUserHandler, fixedUserHandler);
  serverChanged = true;
  console.log('server.js: fixed user handler indentation');
} else {
  console.log('server.js: user handler not found or already fixed');
}

if (serverChanged) {
  fs.writeFileSync(serverPath, server, 'utf8');
  console.log('server.js patched OK');
} else {
  console.log('server.js: no changes needed');
}

// ===== Patch public/index.html =====
const htmlPath = path.join(__dirname, 'public', 'index.html');
let html = fs.readFileSync(htmlPath, 'utf8');

let htmlChanged = false;

// 1. Add CSS for tool_use and tool_result cards
if (!html.includes('workflow-tooluse-card')) {
  const oldToolCard = `/* Tool use card */
.tool-card {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  background: var(--tool-bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  font-size: 12px;
  color: var(--text-dim);
  margin-bottom: 4px;
}
.tool-icon { font-size: 14px; }`;

  const newCSS = `/* Tool use card */
.tool-card {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  background: var(--tool-bg);
  border: 1px solid var(--warning);
  border-radius: 6px;
  font-size: 12px;
  color: var(--warning);
  margin-bottom: 4px;
}
.tool-icon { font-size: 14px; }

/* Workflow tool use card */
.workflow-tooluse-card {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px 12px;
  background: rgba(245, 158, 11, 0.1);
  border: 1px solid rgba(245, 158, 11, 0.3);
  border-radius: 8px;
  margin-bottom: 6px;
  font-size: 13px;
}
.workflow-tooluse-header {
  display: flex;
  align-items: center;
  gap: 6px;
  color: rgba(245, 158, 11, 0.9);
  font-weight: 600;
}
.workflow-tooluse-input {
  color: var(--text-dim);
  font-family: 'Cascadia Code', 'Fira Code', 'Consolas', monospace;
  font-size: 12px;
  white-space: pre-wrap;
  word-break: break-all;
  max-height: 100px;
  overflow-y: auto;
  padding: 4px 0;
}

/* Workflow tool result card */
.workflow-toolresult-card {
  display: flex;
  flex-direction: column;
  gap: 4px;
  border: 1px solid rgba(34, 197, 94, 0.3);
  border-radius: 8px;
  margin-bottom: 6px;
  overflow: hidden;
  background: rgba(34, 197, 94, 0.05);
}
.workflow-toolresult-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 12px;
  cursor: pointer;
  color: rgba(34, 197, 94, 0.9);
  font-size: 12px;
  font-weight: 600;
  user-select: none;
}
.workflow-toolresult-header:hover { background: rgba(34, 197, 94, 0.1); }
.workflow-toolresult-arrow {
  display: inline-block;
  transition: transform 0.2s;
  font-size: 10px;
}
.workflow-toolresult-arrow.open { transform: rotate(90deg); }
.workflow-toolresult-body {
  padding: 8px 12px;
  font-family: 'Cascadia Code', 'Fira Code', 'Consolas', monospace;
  font-size: 12px;
  color: var(--text-dim);
  white-space: pre-wrap;
  max-height: 200px;
  overflow-y: auto;
  display: none;
}
.workflow-toolresult-body.open { display: block; }
.workflow-toolresult-error { color: var(--danger); }`;

  html = html.replace(oldToolCard, newCSS);
  htmlChanged = true;
  console.log('index.html: Added tool_use/tool_result CSS');
} else {
  console.log('index.html: CSS already exists');
}

// 2. Replace addToolUse function with addToolUseCard and addToolResultCard
if (!html.includes('addToolUseCard')) {
  const oldToolUse = `function addToolUse(name) {
  finishThinking();
  createToolCard(currentAssistantEl, name);
  scrollToBottom();
}`;

  const newToolUse = `function addToolUseCard(toolName, toolInput) {
  finishThinking();
  const card = document.createElement('div');
  card.className = 'workflow-tooluse-card';
  const header = document.createElement('div');
  header.className = 'workflow-tooluse-header';
  header.innerHTML = '<span>&#128295;</span> ' + escapeHtml(toolName);
  card.appendChild(header);
  if (toolInput) {
    const inputDiv = document.createElement('div');
    inputDiv.className = 'workflow-tooluse-input';
    if (typeof toolInput === 'object') {
      inputDiv.textContent = JSON.stringify(toolInput, null, 2);
    } else {
      inputDiv.textContent = String(toolInput);
    }
    card.appendChild(inputDiv);
  }
  currentAssistantEl.appendChild(card);
  scrollToBottom();
}

function addToolResultCard(toolId, content, isError) {
  finishThinking();
  const card = document.createElement('div');
  card.className = 'workflow-toolresult-card';
  const header = document.createElement('div');
  header.className = 'workflow-toolresult-header';
  const arrow = document.createElement('span');
  arrow.className = 'workflow-toolresult-arrow';
  arrow.textContent = '\\u25B6';
  const label = document.createElement('span');
  label.textContent = isError ? 'Tool Result (error)' : 'Tool Result';
  if (isError) label.className = 'workflow-toolresult-error';
  header.appendChild(arrow);
  header.appendChild(label);
  card.appendChild(header);
  const body = document.createElement('div');
  body.className = 'workflow-toolresult-body';
  body.textContent = content || '(no output)';
  card.appendChild(body);
  header.addEventListener('click', () => {
    const isOpen = body.classList.toggle('open');
    arrow.classList.toggle('open', isOpen);
  });
  currentAssistantEl.appendChild(card);
  scrollToBottom();
}`;

  html = html.replace(oldToolUse, newToolUse);
  htmlChanged = true;
  console.log('index.html: Added addToolUseCard and addToolResultCard');
} else {
  console.log('index.html: JS handlers already exist');
}

// 3. Update handleChunk to handle tool_use and tool_result chunks
if (!html.includes("_qoder_type === 'tool_result'")) {
  const oldHandle = `  if (chunk._qoder_type === 'tool_use') {
    const toolName = delta.tool_name || delta.content || 'tool';
    addToolUse(toolName);
    return;
  }`;

  const newHandle = `  if (chunk._qoder_type === 'tool_use') {
    const toolName = chunk._qoder_tool_name || '';
    const toolInput = chunk._qoder_tool_input;
    addToolUseCard(toolName, toolInput);
    return;
  }
  if (chunk._qoder_type === 'tool_result') {
    const toolId = chunk._qoder_tool_id || '';
    const isError = chunk._qoder_is_error || false;
    const resContent = delta.content || '';
    addToolResultCard(toolId, resContent, isError);
    return;
  }`;

  html = html.replace(oldHandle, newHandle);
  htmlChanged = true;
  console.log('index.html: Updated handleChunk for tool_use/tool_result');
} else {
  console.log('index.html: handleChunk already updated');
}

if (htmlChanged) {
  fs.writeFileSync(htmlPath, html, 'utf8');
  console.log('index.html patched OK');
} else {
  console.log('index.html: no changes needed');
}

console.log('\n=== All patches complete ===');
