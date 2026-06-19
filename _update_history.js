const fs = require('fs');
const path = 'd:\\_program\\QoderWork\\.history.md';
const old = fs.readFileSync(path, 'utf8');

const newEntry = `## 2026-06-19 17:30 qoder-openapi Tool Use/Thinking SSE + UTF-8 Fix

### Changes
- converter.js: Added extractToolUseFromAssistantMessage/extractToolResultFromUserMessage, fixed thinking markers
- server.js: Added CHCP=65001, toString('utf-8'), thinking/tool_use/tool_result SSE chunks
- index.html: Added workflow-tooluse-card/workflow-toolresult-card CSS/JS, addToolUseCard/addToolResultCard

### Verification
- All converter functions work correctly
- server.js syntax check passed
- All HTML features confirmed present
- Server restarted on port 9680

`;

// Find the first --- separator and insert before it
const sepIdx = old.indexOf('\n---\n');
if (sepIdx > 0) {
  const result = old.substring(0, sepIdx) + '\n---\n\n' + newEntry + '\n' + old.substring(sepIdx + 5);
  fs.writeFileSync(path, result, 'utf8');
  console.log('History updated');
} else {
  // Try different separator format
  const sepIdx2 = old.indexOf('---');
  if (sepIdx2 > 0) {
    const result = old.substring(0, sepIdx2) + '---\n\n' + newEntry + '\n' + old.substring(sepIdx2 + 3);
    fs.writeFileSync(path, result, 'utf8');
    console.log('History updated (alt separator)');
  } else {
    // Just append
    fs.writeFileSync(path, old + '\n\n---\n\n' + newEntry, 'utf8');
    console.log('History appended');
  }
}
