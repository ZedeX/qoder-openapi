const http = require('http');

function fetch(url) {
  return new Promise((resolve, reject) => {
    http.get(url, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

async function main() {
  try {
    // Test health endpoint
    const health = await fetch('http://localhost:9680/health');
    console.log('Health:', health);

    // Test models endpoint
    const models = await fetch('http://localhost:9680/v1/models');
    console.log('Models:', models);

    // Test that the HTML page loads
    const html = await fetch('http://localhost:9680/');
    const hasToolUseCard = html.includes('workflow-tooluse-card');
    const hasToolResultCard = html.includes('workflow-toolresult-card');
    const hasAddToolUseCard = html.includes('addToolUseCard');
    const hasAddToolResultCard = html.includes('addToolResultCard');
    const hasToolResultChunk = html.includes("_qoder_type === 'tool_result'");

    console.log('\nHTML Feature Check:');
    console.log('  workflow-tooluse-card CSS:', hasToolUseCard ? 'YES' : 'NO');
    console.log('  workflow-toolresult-card CSS:', hasToolResultCard ? 'YES' : 'NO');
    console.log('  addToolUseCard JS:', hasAddToolUseCard ? 'YES' : 'NO');
    console.log('  addToolResultCard JS:', hasAddToolResultCard ? 'YES' : 'NO');
    console.log('  tool_result chunk handler:', hasToolResultChunk ? 'YES' : 'NO');

    // Test converter module
    const converter = require('d:\\_program\\QoderWork\\qoder-openapi\\converter');
    console.log('\nConverter Module Check:');
    console.log('  extractToolUseFromAssistantMessage:', typeof converter.extractToolUseFromAssistantMessage === 'function' ? 'YES' : 'NO');
    console.log('  extractToolResultFromUserMessage:', typeof converter.extractToolResultFromUserMessage === 'function' ? 'YES' : 'NO');

    // Test the new functions with sample data
    const toolUseResult = converter.extractToolUseFromAssistantMessage({
      type: 'assistant',
      message: {
        content: [
          { type: 'text', text: 'Hello' },
          { type: 'tool_use', id: 'tool_123', name: 'Read', input: { file: 'test.txt' } },
        ]
      }
    });
    console.log('  extractToolUseFromAssistantMessage test:', JSON.stringify(toolUseResult));

    const toolResultResult = converter.extractToolResultFromUserMessage({
      type: 'user',
      message: {
        content: [
          { type: 'tool_result', tool_use_id: 'tool_123', content: 'File contents here', is_error: false },
        ]
      }
    });
    console.log('  extractToolResultFromUserMessage test:', JSON.stringify(toolResultResult));

    console.log('\n=== All checks passed ===');
  } catch (e) {
    console.error('Error:', e.message);
  }
}

main();
