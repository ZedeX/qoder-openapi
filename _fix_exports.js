const fs = require('fs');
const path = require('path');

const converterPath = path.join(__dirname, 'converter.js');
let c = fs.readFileSync(converterPath, 'utf8');

// Find module.exports and add the missing functions
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

if (c.includes('extractToolUseFromAssistantMessage,')) {
  console.log('Exports already include new functions');
} else if (c.includes(oldExports)) {
  c = c.replace(oldExports, newExports);
  fs.writeFileSync(converterPath, c, 'utf8');
  console.log('Updated module.exports with new functions');
} else {
  // Try regex approach
  const lines = c.split('\n');
  let startIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('module.exports')) {
      startIdx = i;
      break;
    }
  }
  if (startIdx >= 0) {
    // Find extractThinkingFromAssistantMessage line
    for (let i = startIdx; i < lines.length; i++) {
      if (lines[i].includes('extractThinkingFromAssistantMessage,')) {
        // Insert new exports after this line
        lines.splice(i + 1, 0, '  extractToolUseFromAssistantMessage,', '  extractToolResultFromUserMessage,');
        c = lines.join('\n');
        fs.writeFileSync(converterPath, c, 'utf8');
        console.log('Inserted new functions into module.exports');
        break;
      }
    }
  } else {
    console.log('ERROR: could not find module.exports');
  }
}

// Verify
const verify = fs.readFileSync(converterPath, 'utf8');
if (verify.includes('extractToolUseFromAssistantMessage,') && verify.includes('extractToolResultFromUserMessage,')) {
  console.log('converter.js exports: VERIFIED OK');
} else {
  console.log('converter.js exports: VERIFICATION FAILED');
}
