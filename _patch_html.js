const fs = require('fs');
const path = require('path');
const htmlPath = path.join(__dirname, 'public', 'index.html');
let html = fs.readFileSync(htmlPath, 'utf8');

// 1. Add CSS for tool_use and tool_result cards
if (!html.includes('tooluse-card')) {
  const oldToolCard = '/* Tool use card */
.tool-card {';
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

/* Tool use card */
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

/* Tool result card */
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
.workflow-toolresult-error { color: var(--danger); }
`;
  html = html.replace(oldToolCard, newCSS);
  console.log('index.html: Added tool_use/tool_result CSS');
} else {
  console.log('index.html: CSS already exists');
}

// 2. Add JS handler for tool_use and tool_result SSE chunks
if (!html.includes('addToolUseCard')) {
  const oldToolUse = "function addToolUse(name) {
  finishThinking();
  createToolCard(currentAssistantEl, name);
  scrollToBottom();
}";
  const newToolUse = `function addToolUseCard(toolName, toolInput) {
  finishThinking();
  const card = document.createElement('div');
  card.className = 'workflow-tooluse-card';
  const header = document.createElement('div');
  header.className = 'workflow-tooluse-header';
  header.innerHTML = '<span>&#128;95;</span> ' + escapeHtml(toolName);
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
  arrow.textContent = '&#9654;';
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
}
`;
  html = html.replace(oldToolUse, newToolUse);
  console.log('index.html: Added tool_use/tool_result JS handlers');
} else {
  console.log('index.html: JS handlers already exist');
}

// 3. Update handleChunk to handle tool_use and tool_result chunks
if (!html.includes("_qoder_type === 'tool_use'")) {
  const oldHandle = "  if (chunk._qoder_type === 'tool_use') {\n    const toolName = delta.tool_name || delta.content || 'tool';\n    addToolUse(toolName);\n    return;\n  }";
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
  console.log('index.html: Updated handleChunk for tool_use/tool_result');
} else {
  console.log('index.html: handleChunk already updated');
}

fs.writeFileSync(htmlPath, html, 'utf8');
console.log('index.html patched successfully!');