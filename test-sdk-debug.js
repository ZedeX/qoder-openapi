// Debug: test SDK query directly with different configurations
const path = require('path');

async function testSDK() {
  // Load SDK
  const sdkPath = 'd:\\_program\\QoderWork\\resources\\app.asar.unpacked\\node_modules\\@ali\\qoder-agent-sdk';
  const sdk = require(sdkPath);

  // Test 1: Without integrationMode (let qodercli use its own config)
  console.log('=== Test 1: SDK without integrationMode ===');
  try {
    // Don't call configure() - let SDK use defaults
    const queryOptions = {
      model: 'qwork-auto',
      cwd: process.cwd(),
      permissionMode: 'bypassPermissions',
      allowDangerouslySkipPermissions: true,
      maxTurns: 1,
      pathToQoderCLIExecutable: 'd:\\_program\\QoderWork\\resources\\bin\\qodercli.exe',
    };

    console.log('Query options:', JSON.stringify(queryOptions, null, 2));

    const queryParams = {
      prompt: 'Say hello in one word',
      options: queryOptions,
    };

    console.log('Starting query...');
    const queryResult = sdk.query(queryParams);

    // Iterate through results
    let count = 0;
    for await (const msg of queryResult) {
      count++;
      const msgStr = JSON.stringify(msg);
      console.log(`MSG ${count}: type=${msg.type}, len=${msgStr.length}`);
      console.log('  Preview:', msgStr.substring(0, 300));
      if (msg.type === 'result') {
        console.log('  Result content:', msg.result?.substring?.(0, 200) || JSON.stringify(msg).substring(0, 200));
        break;
      }
      if (count > 50) {
        console.log('Too many messages, stopping...');
        break;
      }
    }
    console.log(`Total messages: ${count}`);
  } catch (e) {
    console.error('Test 1 error:', e.message);
    console.error('Stack:', e.stack?.substring(0, 500));
  }
}

testSDK().catch(console.error);
