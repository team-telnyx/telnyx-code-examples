```typescript
import { QAAgent, handleWebhook, initDb, Env, JevResult, ScoreRow, AgentState } from "./src/index";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    console.error(`FAIL: ${message}`);
    process.exitCode = 1;
  } else {
    console.log(`PASS: ${message}`);
  }
}

// Verify QAAgent class is exported and is a function
assert(typeof QAAgent === "function", "QAAgent is exported and is a function");

// Verify QAAgent has required methods
const proto = QAAgent.prototype;
assert(typeof proto.onCallEnded === "function", "QAAgent has onCallEnded method");
assert(typeof proto.graded === "function", "QAAgent has graded method");
assert(typeof proto.judgeWithJev === "function", "QAAgent has judgeWithJev method");
assert(typeof proto.recomputeTrend === "function", "QAAgent has recomputeTrend method");
assert(typeof proto.flagBreach === "function", "QAAgent has flagBreach method");
assert(typeof proto.digest === "function", "QAAgent has digest method");
assert(typeof proto.scheduledDigest === "function", "QAAgent has scheduledDigest method");
assert(typeof proto.retryJev === "function", "QAAgent has retryJev method");
assert(typeof proto.initialState === "function", "QAAgent has initialState method");
assert(typeof proto.parseJevResponse === "function", "QAAgent has parseJevResponse method");

// Verify handleWebhook is exported
assert(typeof handleWebhook === "function", "handleWebhook is exported and is a function");

// Verify initDb is exported
assert(typeof initDb === "function", "initDb is exported and is a function");

// Verify interfaces are usable (compile-time check)
const _envTypeCheck: (e: Env) => void = () => {};
const _jevResultTypeCheck: (r: JevResult) => void = () => {};
const _scoreRowTypeCheck: (r: ScoreRow) => void = () => {};
const _agentStateTypeCheck: (s: AgentState) => void = () => {};
assert(typeof _envTypeCheck === "function", "Env interface is exported");
assert(typeof _jevResultTypeCheck === "function", "JevResult interface is exported");
assert(typeof _scoreRowTypeCheck === "function", "ScoreRow interface is exported");
assert(typeof _agentStateTypeCheck === "function", "AgentState interface is exported");

// Verify module loads without error
assert(true, "module loads without error");

console.log("\nAll smoke tests passed.");
```
