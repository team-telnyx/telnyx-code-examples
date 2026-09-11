import { TwoFactorAgent } from './src/index.ts';

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

console.log('Running smoke test for sms-two-factor-agent...');

// Verify the Agent class is exported and has the expected shape
assert(typeof TwoFactorAgent === 'function', 'TwoFactorAgent must be a class/function');
assert(
  TwoFactorAgent.name === 'TwoFactorAgent',
  `Expected class name 'TwoFactorAgent', got '${TwoFactorAgent.name}'`,
);

// Verify prototype methods exist (Agent SDK contract)
const proto = TwoFactorAgent.prototype;
assert(typeof proto.sendCode === 'function', 'Missing sendCode method');
assert(typeof proto.verifyCode === 'function', 'Missing verifyCode method');
assert(typeof proto.expireCode === 'function', 'Missing expireCode (scheduled handler) method');

console.log('✅ All smoke test assertions passed. Module loads correctly.');
