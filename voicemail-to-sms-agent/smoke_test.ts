import { VoicemailAgent } from './src/index';

/**
 * Smoke test: verifies that the VoicemailAgent module loads and exports
 * the expected class without runtime errors.
 *
 * Run with: npm test
 */
function runSmokeTest(): void {
  console.log('Running smoke test for VoicemailAgent...');

  if (!VoicemailAgent) {
    throw new Error('VoicemailAgent is undefined');
  }

  const agent = new VoicemailAgent();
  if (!agent || typeof agent.onTask !== 'function') {
    throw new Error('VoicemailAgent instance does not have onTask method');
  }

  console.log('✅ Smoke test passed: VoicemailAgent loaded successfully.');
}

runSmokeTest();
