const sdk = require('d:/_program/QoderWork/resources/app.asar.unpacked/node_modules/@ali/qoder-agent-sdk');
const path = require('path');

async function test() {
  const storageDir = path.join(process.env.APPDATA, 'QoderWork');
  const resourceDir = 'd:\\_program\\QoderWork\\resources';

  console.log('Storage Dir:', storageDir);
  console.log('Resource Dir:', resourceDir);

  // Configure SDK
  sdk.configure({
    storageDir: storageDir,
    resourceDir: resourceDir,
    integrationMode: 'qoder_work'
  });

  // Test Named Pipe connection
  const chatEndpoint = '//./pipe/qoderwork-chat';
  console.log('\nTesting Named Pipe connection to:', chatEndpoint);

  try {
    const result = await sdk.isConnectable({
      chatEndpoint: chatEndpoint,
      timeoutMs: 5000,
      retries: 2
    });
    console.log('isConnectable result:', result);
  } catch (e) {
    console.log('isConnectable error:', e.message);
  }

  // Also check what methods are available
  console.log('\nSDK exports:', Object.keys(sdk).join(', '));
  console.log('SDK configure type:', typeof sdk.configure);
  console.log('SDK query type:', typeof sdk.query);
  console.log('SDK isConnectable type:', typeof sdk.isConnectable);

  // Check TcpTransport
  if (sdk.TcpTransport) {
    console.log('TcpTransport available');
  }

  // Try to list models
  try {
    if (sdk.listModels) {
      const models = await sdk.listModels();
      console.log('Models:', JSON.stringify(models).substring(0, 500));
    }
  } catch (e) {
    console.log('listModels error:', e.message);
  }
}

test().catch(e => console.error('Fatal:', e.message));
