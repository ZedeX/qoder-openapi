// Test script to verify message-logger and converter modifications
try {
  const messageLogger = require('./message-logger');
  console.log('message-logger.js loaded OK');

  // Test startLog
  const logId = messageLogger.startLog({
    requestId: 'test-001',
    model: 'qwork-auto',
    messages: [{ role: 'user', content: 'Hello' }],
    stream: false,
    max_tokens: 4096,
    temperature: 0.7,
    max_turns: 5,
    prompt: '[User]\nHello',
  });
  console.log('startLog OK, logId:', logId);

  // Test addSdkMessage
  messageLogger.addSdkMessage(logId, { type: 'stream_event', event: { delta: { text: 'Hi' } } });
  console.log('addSdkMessage OK');

  // Test addContent
  messageLogger.addContent(logId, 'Hi there! ');
  messageLogger.addContent(logId, 'How can I help?');
  console.log('addContent OK');

  // Test addThinking
  messageLogger.addThinking(logId, 'The user said hello...');
  console.log('addThinking OK');

  // Test addToolUse
  messageLogger.addToolUse(logId, { id: 'tool-1', type: 'tool_use', name: 'read_file', input: { path: '/tmp/test' } });
  console.log('addToolUse OK');

  // Test completeLog
  messageLogger.completeLog(logId, {
    content: 'Hi there! How can I help?',
    thinking: 'The user said hello...',
    toolUse: [{ id: 'tool-1', type: 'tool_use', name: 'read_file', input: { path: '/tmp/test' } }],
    finishReason: 'stop',
    usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
  });
  console.log('completeLog OK');

  // Test getLogs
  const logs = messageLogger.getLogs(10, 0);
  console.log('getLogs OK, total:', logs.total, 'items:', logs.items.length);

  // Test getLog
  const log = messageLogger.getLog(logId);
  console.log('getLog OK, status:', log.status, 'duration:', log.duration, 'content:', log.response.content);

  // Test converter
  const converter = require('./converter');
  const testMsg = {
    type: 'stream_event',
    event: {
      delta: { thinking: 'I am thinking...' },
    },
  };
  const chunk = converter.sdkStreamEventToOpenAIChunk(testMsg, 'qwork-auto', 'chatcmpl-test');
  console.log('converter thinking chunk _qoder_type:', chunk._qoder_type);
  console.log('converter thinking chunk content:', chunk.choices[0].delta.content);

  // Test tool_use chunk
  const toolMsg = {
    type: 'stream_event',
    event: {
      content_block: { type: 'tool_use', id: 'tool-abc', name: 'bash', input: {} },
    },
  };
  const toolChunk = converter.sdkStreamEventToOpenAIChunk(toolMsg, 'qwork-auto', 'chatcmpl-test');
  console.log('converter tool_use chunk _qoder_type:', toolChunk._qoder_type);
  console.log('converter tool_use chunk _qoder_tool:', JSON.stringify(toolChunk._qoder_tool));

  // Test text chunk
  const textMsg = {
    type: 'stream_event',
    event: {
      delta: { text: 'Hello world' },
    },
  };
  const textChunk = converter.sdkStreamEventToOpenAIChunk(textMsg, 'qwork-auto', 'chatcmpl-test');
  console.log('converter text chunk _qoder_type:', textChunk._qoder_type);

  // Test clearLogs
  messageLogger.clearLogs();
  const emptyLogs = messageLogger.getLogs(10, 0);
  console.log('clearLogs OK, total after clear:', emptyLogs.total);

  console.log('\nAll tests passed!');
} catch (err) {
  console.error('Test failed:', err.message, err.stack);
  process.exit(1);
}
