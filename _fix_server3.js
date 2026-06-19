const fs = require('fs');
const path = require('path');

const serverPath = path.join(__dirname, 'server.js');
let server = fs.readFileSync(serverPath, 'utf8');

// Fix the broken section between result handler and catch block
// Current broken code (after previous patches):
const brokenSection = `          } else if (msg.type === 'result') {
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


      } catch (streamErr) {`;

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
          }
      } catch (streamErr) {`;

if (server.includes(brokenSection)) {
  server = server.replace(brokenSection, fixedSection);
  fs.writeFileSync(serverPath, server, 'utf8');
  console.log('Fixed broken section in server.js');
} else {
  console.log('Could not find broken section - trying alternative approach');

  // Alternative: use line-by-line fix
  const lines = server.split('\n');
  let fixed = false;

  for (let i = 0; i < lines.length; i++) {
    // Fix the misplaced "} else if (msg.type === 'user')"
    if (lines[i].trim() === '} else if (msg.type === \'user\') {' && !lines[i].startsWith(' ')) {
      lines[i] = '          } else if (msg.type === \'user\') {';
      fixed = true;
      console.log('Fixed user handler indentation at line', i);
    }
  }

  // Find the line after the user handler's closing brace (after "res.write(converter.formatSSE(toolResultChunk));" and the for-loop close)
  // and before "} catch" - we need to add the missing closing braces
  let catchIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('} catch (streamErr) {')) {
      catchIdx = i;
      break;
    }
  }

  if (catchIdx >= 0) {
    // Check if there are enough closing braces before catch
    let prevNonEmpty = catchIdx - 1;
    while (prevNonEmpty >= 0 && lines[prevNonEmpty].trim() === '') {
      prevNonEmpty--;
    }
    console.log('Line before catch:', prevNonEmpty, JSON.stringify(lines[prevNonEmpty]));

    // We need: }  (close user handler) + } (close for-await loop body)
    // The for-await loop body should be closed before catch
    // Check if we need to add closing braces
    const lineBeforeCatch = lines[prevNonEmpty].trim();
    if (lineBeforeCatch === '}' || lineBeforeCatch.includes('res.write')) {
      // We need to add the missing braces
      // Insert before the catch line
      lines.splice(catchIdx, 0, '          }', '      }');
      fixed = true;
      console.log('Added missing closing braces before catch');
    }
  }

  if (fixed) {
    server = lines.join('\n');
    fs.writeFileSync(serverPath, server, 'utf8');
    console.log('server.js fixed via line-by-line approach');
  } else {
    console.log('No fixes applied');
  }
}

// Verify syntax
try {
  const finalContent = fs.readFileSync(serverPath, 'utf8');
  new Function(finalContent);
  console.log('server.js: syntax check PASSED');
} catch (e) {
  console.log('server.js: SYNTAX ERROR:', e.message);
}
