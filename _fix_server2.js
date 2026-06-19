const fs = require('fs');
const path = require('path');

const serverPath = path.join(__dirname, 'server.js');
let server = fs.readFileSync(serverPath, 'utf8');
const lines = server.split('\n');

// Find key lines by content
let thinkingLineIdx = -1;
let toolUseLineIdx = -1;
let resultHandlerIdx = -1;

for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes("messageLogger.addThinking(msgLogId, thinking);") && thinkingLineIdx === -1) {
    thinkingLineIdx = i;
  }
  if (lines[i].includes("messageLogger.addToolUse(msgLogId, toolInfo);") && toolUseLineIdx === -1) {
    toolUseLineIdx = i;
  }
  if (lines[i].includes("} else if (msg.type === 'result') {") && resultHandlerIdx === -1) {
    resultHandlerIdx = i;
  }
}

console.log('thinkingLineIdx:', thinkingLineIdx, lines[thinkingLineIdx]?.trim());
console.log('toolUseLineIdx:', toolUseLineIdx, lines[toolUseLineIdx]?.trim());
console.log('resultHandlerIdx:', resultHandlerIdx, lines[resultHandlerIdx]?.trim());

let changed = false;

// 1. Add thinking SSE chunk after the thinking logging line
if (thinkingLineIdx >= 0 && !server.includes("_qoder_type: 'thinking',")) {
  const indent = lines[thinkingLineIdx].match(/^(\s*)/)[1];
  // Find the closing brace of the if (thinking) block
  let closeIdx = thinkingLineIdx + 1;
  while (closeIdx < lines.length && !lines[closeIdx].trim().startsWith('}')) {
    closeIdx++;
  }
  console.log('Thinking block close at line', closeIdx, lines[closeIdx]?.trim());

  // Insert thinking SSE chunk before the closing brace
  const thinkingChunk = [
    '',
    indent + '// Send thinking SSE chunk',
    indent + 'const thinkingChunk = {',
    indent + '  id: requestId,',
    indent + "  object: 'chat.completion.chunk',",
    indent + '  created: Math.floor(Date.now() / 1000),',
    indent + '  model: resolvedModel,',
    indent + '  choices: [{ index: 0, delta: { content: thinking }, finish_reason: null }],',
    indent + "  _qoder_type: 'thinking',",
    indent + '};',
    indent + 'res.write(converter.formatSSE(thinkingChunk));',
  ];

  lines.splice(closeIdx, 0, ...thinkingChunk);
  changed = true;
  console.log('Added thinking SSE chunk');
} else if (server.includes("_qoder_type: 'thinking',")) {
  console.log('Thinking SSE chunk already exists');
} else {
  console.log('ERROR: could not find thinking line');
}

// Re-read lines after potential modification
if (changed) {
  // Recalculate toolUseLineIdx since lines shifted
  server = lines.join('\n');
  const newLines = server.split('\n');
  toolUseLineIdx = -1;
  resultHandlerIdx = -1;
  for (let i = 0; i < newLines.length; i++) {
    if (newLines[i].includes("messageLogger.addToolUse(msgLogId, toolInfo);") && toolUseLineIdx === -1) {
      toolUseLineIdx = i;
    }
    if (newLines[i].includes("} else if (msg.type === 'result') {") && resultHandlerIdx === -1) {
      resultHandlerIdx = i;
    }
  }
}

// 2. Add tool_use SSE chunk after the tool_use logging line
if (toolUseLineIdx >= 0 && !server.includes("_qoder_tool_name: block.name")) {
  const currentLines = server.split('\n');
  const indent = currentLines[toolUseLineIdx].match(/^(\s*)/)[1];
  // Find the closing brace of the if (block.type === 'tool_use') block
  let closeIdx = toolUseLineIdx + 1;
  while (closeIdx < currentLines.length && !currentLines[closeIdx].trim().startsWith('}')) {
    closeIdx++;
  }
  console.log('Tool_use block close at line', closeIdx, currentLines[closeIdx]?.trim());

  const toolUseChunk = [
    '',
    indent + '// Send tool_use SSE chunk',
    indent + 'const toolUseChunk = {',
    indent + '  id: requestId,',
    indent + "  object: 'chat.completion.chunk',",
    indent + '  created: Math.floor(Date.now() / 1000),',
    indent + '  model: resolvedModel,',
    indent + '  choices: [{ index: 0, delta: {}, finish_reason: null }],',
    indent + "  _qoder_type: 'tool_use',",
    indent + "  _qoder_tool_name: block.name || '',",
    indent + '  _qoder_tool_input: block.input || {},',
    indent + "  _qoder_tool_id: block.id || '',",
    indent + '};',
    indent + 'res.write(converter.formatSSE(toolUseChunk));',
  ];

  currentLines.splice(closeIdx, 0, ...toolUseChunk);
  server = currentLines.join('\n');
  changed = true;
  console.log('Added tool_use SSE chunk');
} else if (server.includes("_qoder_tool_name: block.name")) {
  console.log('Tool_use SSE chunk already exists');
} else {
  console.log('ERROR: could not find tool_use line');
}

// 3. Fix the broken user message handler structure
// Check if the user handler is outside the if-else chain
const currentLines2 = server.split('\n');
for (let i = 0; i < currentLines2.length; i++) {
  if (currentLines2[i].includes("} else if (msg.type === 'user') {")) {
    // Check if previous line is a closing brace at wrong indentation
    const prevLine = currentLines2[i - 1]?.trim() || '';
    if (prevLine === '}') {
      console.log('Found user handler at line', i, 'with prev line:', currentLines2[i-1]?.trim());
      // This means the user handler is outside the if-else chain
      // We need to merge it back in
      // Find the result handler closing brace
      let resultCloseIdx = i - 1;
      console.log('Need to fix: remove the extra closing brace at line', resultCloseIdx);
      // Replace the two lines: "} \n } else if (msg.type === 'user')" with "} else if (msg.type === 'user')"
      currentLines2[resultCloseIdx] = '';
      server = currentLines2.join('\n');
      changed = true;
      console.log('Fixed user handler: removed extra closing brace');
    }
    break;
  }
}

// Also fix the trailing comment and wrong closing brace after the user handler
const currentLines3 = server.split('\n');
for (let i = 0; i < currentLines3.length; i++) {
  if (currentLines3[i].includes("// Skip system, user, and other message types")) {
    // This line and the next closing brace are wrong
    console.log('Found stray comment at line', i);
    currentLines3[i] = '';  // Remove the comment
    // Check if next line is a stray closing brace
    if (currentLines3[i + 1]?.trim() === '}') {
      // Check if this is an extra brace that doesn't belong
      // Count braces to see if it's balanced
      currentLines3[i + 1] = '';
      console.log('Removed stray closing brace at line', i + 1);
    }
    server = currentLines3.join('\n');
    changed = true;
    break;
  }
}

if (changed) {
  fs.writeFileSync(serverPath, server, 'utf8');
  console.log('server.js patched OK');
} else {
  console.log('server.js: no changes applied');
}

// Verify the file is syntactically valid
try {
  require('fs').readFileSync(serverPath, 'utf8');
  // Try to parse it
  new Function(server);
  console.log('server.js: syntax check passed');
} catch (e) {
  console.log('server.js: SYNTAX ERROR:', e.message);
}
