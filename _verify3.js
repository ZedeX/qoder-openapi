const { execSync } = require('child_process');
const path = require('path');

const nodeExe = 'D:\\_program\\node\\node.exe';
const baseDir = 'd:\\_program\\QoderWork\\qoder-openapi';

// Syntax check
const files = ['converter.js', 'server.js'];
for (const f of files) {
  try {
    execSync(`"${nodeExe}" -c "${path.join(baseDir, f)}"`, { encoding: 'utf-8', timeout: 10000 });
    console.log(`[OK] ${f} syntax check passed`);
  } catch (e) {
    console.error(`[FAIL] ${f} syntax error: ${e.message}`);
    process.exit(1);
  }
}

// Test converter functions
try {
  const converter = require(path.join(baseDir, 'converter.js'));

  // Test extractToolUseFromAssistantMessage
  const toolUseMsg = {
    type: 'assistant',
    message: {
      content: [
        { type: 'text', text: 'Let me read that file.' },
        { type: 'tool_use', id: 'tool_123', name: 'Read', input: { file: 'test.txt' } }
      ]
    }
  };
  const toolUses = converter.extractToolUseFromAssistantMessage(toolUseMsg);
  console.log('[OK] extractToolUseFromAssistantMessage:', JSON.stringify(toolUses));

  // Test extractToolResultFromUserMessage
  const toolResultMsg = {
    type: 'user',
    message: {
      content: [
        { type: 'tool_result', tool_use_id: 'tool_123', content: 'File contents here', is_error: false }
      ]
    }
  };
  const toolResults = converter.extractToolResultFromUserMessage(toolResultMsg);
  console.log('[OK] extractToolResultFromUserMessage:', JSON.stringify(toolResults));

  // Test extractThinkingFromAssistantMessage
  const thinkingMsg = {
    type: 'assistant',
    message: {
      content: [
        { type: 'thinking', thinking: 'I need to analyze this carefully...' },
        { type: 'text', text: 'Here is my answer.' }
      ]
    }
  };
  const thinking = converter.extractThinkingFromAssistantMessage(thinkingMsg);
  console.log('[OK] extractThinkingFromAssistantMessage:', thinking);

  // Test sdkStreamEventToOpenAIChunk with thinking
  const thinkingEvent = {
    type: 'stream_event',
    event: { delta: { thinking: 'Let me think about this...' } }
  };
  const thinkingChunk = converter.sdkStreamEventToOpenAIChunk(thinkingEvent, 'test-model', 'test-id');
  console.log('[OK] sdkStreamEventToOpenAIChunk (thinking):', JSON.stringify({ qoderType: thinkingChunk._qoder_type, content: thinkingChunk.choices[0].delta.content }));

  // Verify no <<thinking>> markers
  if (thinkingChunk.choices[0].delta.content.includes('<<thinking>>')) {
    console.error('[FAIL] Thinking content still has <<thinking>> markers!');
    process.exit(1);
  } else {
    console.log('[OK] No <<thinking>> markers in thinking content');
  }

  // Check exports
  const requiredExports = ['extractToolUseFromAssistantMessage', 'extractToolResultFromUserMessage', 'extractThinkingFromAssistantMessage', 'extractTextFromAssistantMessage'];
  for (const exp of requiredExports) {
    if (typeof converter[exp] !== 'function') {
      console.error(`[FAIL] Missing export: ${exp}`);
      process.exit(1);
    }
    console.log(`[OK] Export: ${exp}`);
  }

} catch (e) {
  console.error('[FAIL] Converter test error:', e.message);
  process.exit(1);
}

console.log('\n=== All verification tests passed! ===');
