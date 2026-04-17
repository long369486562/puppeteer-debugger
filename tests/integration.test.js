const CDPManager = require('../server/cdp-manager');

async function runTests() {
  console.log('🧪 Running Puppeteer Debugger Tests...\n');

  let passed = 0;
  let failed = 0;

  function assert(condition, message) {
    if (condition) {
      console.log('✅ PASS:', message);
      passed++;
    } else {
      console.log('❌ FAIL:', message);
      failed++;
    }
  }

  try {
    // Test 1: CDPManager instantiation
    const cdpManager = new CDPManager();
    assert(cdpManager instanceof CDPManager, 'CDPManager should be instantiable');

    // Test 2: Required methods exist
    assert(typeof cdpManager.connect === 'function', 'connect method should exist');
    assert(typeof cdpManager.disconnect === 'function', 'disconnect method should exist');
    assert(typeof cdpManager.getTargets === 'function', 'getTargets method should exist');
    assert(typeof cdpManager.evaluateCode === 'function', 'evaluateCode method should exist');
    assert(typeof cdpManager.setupConsoleListener === 'function', 'setupConsoleListener method should exist');

    // Test 3: Config loading
    const config = require('../config');
    assert(typeof config === 'object', 'Config should be loaded');
    assert(config.server && config.server.port === 9000, 'Server config should be correct');
    assert(config.chrome && config.chrome.defaultPort === 9555, 'Chrome config should be correct');

    console.log(`\n📊 Test Results: ${passed} passed, ${failed} failed`);

    if (failed === 0) {
      console.log('🎉 All tests passed!');
      process.exit(0);
    } else {
      console.log('💥 Some tests failed!');
      process.exit(1);
    }

  } catch (error) {
    console.error('💥 Test runner failed:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  runTests();
}

module.exports = { runTests };