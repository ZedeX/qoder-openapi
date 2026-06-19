const converter = require('d:\\_program\\QoderWork\\qoder-openapi\\converter');
console.log('extractToolUseFromAssistantMessage:', typeof converter.extractToolUseFromAssistantMessage);
console.log('extractToolResultFromUserMessage:', typeof converter.extractToolResultFromUserMessage);

const toolUseResult = converter.extractToolUseFromAssistantMessage({
  type: 'assistant',
  message: {
    content: [
      { type: 'text', text: 'Hello' },
      { type: 'tool_use', id: 'tool_123', name: 'Read', input: { file: 'test.txt' } },
    ]
  }
});
console.log('toolUse test:', JSON.stringify(toolUseResult));

const toolResultResult = converter.extractToolResultFromUserMessage({
  type: 'user',
  message: {
    content: [
      { type: 'tool_result', tool_use_id: 'tool_123', content: 'File contents here', is_error: false },
    ]
  }
});
console.log('toolResult test:', JSON.stringify(toolResultResult));

// Test server.js syntax
try {
  const fs = require('fs');
  const serverContent = fs.readFileSync('d:\\_program\\QoderWork\\qoder-openapi\\server.js', 'utf8');
  new Function(serverContent);
  console.log('server.js syntax: OK');
} catch (e) {
  console.log('server.js syntax ERROR:', e.message);
}

// Test index.html features
const fs = require('fs');
const html = fs.readFileSync('d:\\_program\\QoderWork\\qoder-openapi\\public\\index.html', 'utf8');
console.log('HTML features:');
console.log('  workflow-tooluse-card:', html.includes('workflow-tooluse-card'));
console.log('  workflow-toolresult-card:', html.includes('workflow-toolresult-card'));
console.log('  addToolUseCard:', html.includes('addToolUseCard'));
console.log('  addToolResultCard:', html.includes('addToolResultCard'));
console.log('  _qoder_type tool_result:', html.includes("_qoder_type === 'tool_result'"));
console.log('  _qoder_type tool_use:', html.includes("_qoder_type === 'tool_use'"));
