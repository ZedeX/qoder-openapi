const fs = require('fs');
const path = require('path');

const serverPath = path.join(__dirname, 'server.js');
let server = fs.readFileSync(serverPath, 'utf8');

let changed = false;

// 1. Add thinking SSE chunk after thinking extraction
// Current code (lines 696-699):
const thinkingOld = `            if (thinking) {
              fullThinking += thinking;
              messageLogger.addThinking(msgLogId, thinking);
            }`;

const thinkingNew = `            if (thinking) {
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
  console.log('thinking SSE chunk already exists');
} else if (server.includes(thinkingOld)) {
  server = server.replace(thinkingOld, thinkingNew);
  changed = true;
  console.log('Added thinking SSE chunk');
} else {
  console.log('ERROR: could not find thinking marker');
}

// 2. Add tool_use SSE chunk after tool_use extraction
// Current code (lines 745-749):
const toolUseOld = `                if (block.type === 'tool_use') {
                  const toolInfo = { id: block.id, type: block.type, name: block.name, input: block.input };
                  toolUseList.push(toolInfo);
                  messageLogger.addToolUse(msgLogId, toolInfo);
                }`;

const toolUseNew = `                if (block.type === 'tool_use') {
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

if (server.includes("_qoder_tool_name: block.name")) {
  console.log('tool_use SSE chunk already exists');
} else if (server.includes(toolUseOld)) {
  server = server.replace(toolUseOld, toolUseNew);
  changed = true;
  console.log('Added tool_use SSE chunk');
} else {
  console.log('ERROR: could not find tool_use marker');
}

// 3. Fix the broken user message handler
// The current code has the user handler outside the if-else chain
// We need to move it inside and fix the structure
const brokenSection = `          } else if (msg.type === 'result') {
            resultMsg = msg;
            // For direct CLI mode, the actual text content may be in result.result
            // if assistant messages only contained thinking content
            if (useDirectCLI && msg.result && !fullText.trim()) {
              fullText = msg.result;
              messageLogger.addContent(msgLogId, msg.result);
            }
          }
} else if (msg.type === 'user') {
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

const fixedSection = `          } else if (msg.type === 'result') {
            resultMsg = msg;
            // For direct CLI mode, the actual text content may be in result.result
            // if assistant messages only contained thinking content
            if (useDirectCLI && msg.result && !fullText.trim()) {
              fullText = msg.result;
              messageLogger.addContent(msgLogId, msg.result);
            }
          } else if (msg.type === 'user') {
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

if (server.includes(brokenSection)) {
  server = server.replace(brokenSection, fixedSection);
  changed = true;
  console.log('Fixed user handler indentation and structure');
} else if (server.includes("} else if (msg.type === 'user') {") && server.includes("_qoder_type: 'tool_result',")) {
  // Check if it's already fixed
  const userHandlerPattern = `} else if (msg.type === 'user') {
            // Handle tool_result from user messages`;
  if (server.includes(userHandlerPattern)) {
    console.log('User handler appears to already be in correct position');
  } else {
    console.log('WARNING: user handler exists but in unexpected format');
  }
} else {
  console.log('ERROR: could not find broken user handler section');
}

if (changed) {
  fs.writeFileSync(serverPath, server, 'utf8');
  console.log('server.js patched OK');
} else {
  console.log('server.js: no changes applied');
}
