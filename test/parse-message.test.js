#!/usr/bin/env node

// Tests for panel.js's parseMessage — the command/@mention parser that decides
// between plain send, cross-reference and mutual review. Pure logic, loaded in
// a vm sandbox with minimal DOM stubs (panel.js only touches the DOM at load
// time to cache element references; those are never exercised here).

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');

function loadPanel() {
  const stubElement = () => ({
    value: '',
    addEventListener() {},
    classList: { add() {}, remove() {}, toggle() { return false; } }
  });

  const sandbox = {
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    document: {
      getElementById: () => stubElement(),
      querySelectorAll: () => [],
      querySelector: () => null,
      addEventListener() {},
      createElement: () => ({
        textContent: '',
        set innerHTML(v) {}, get innerHTML() { return ''; }
      })
    },
    chrome: {
      runtime: {
        onMessage: { addListener() {} },
        sendMessage: () => {}
      },
      storage: { local: { get: () => {}, set: () => {} } },
      tabs: { query: async () => [] }
    }
  };
  vm.createContext(sandbox);
  vm.runInContext(
    fs.readFileSync(path.join(ROOT, 'sidepanel/panel.js'), 'utf8'),
    sandbox,
    { filename: 'sidepanel/panel.js' }
  );
  return sandbox;
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

(async () => {
  const { parseMessage } = loadPanel();
  if (typeof parseMessage !== 'function') throw new Error('parseMessage not found');

  // ---- /mutual with default prompt ----
  let p = parseMessage('/mutual');
  assert(p.mutual === true, '/mutual should set mutual');
  assert(p.crossRef === false, '/mutual should not be crossRef');
  assert(p.prompt.includes('请评价以上观点'), '/mutual default prompt missing');

  // ---- /mutual with custom prompt ----
  p = parseMessage('/mutual 聚焦安全性差异');
  assert(p.mutual === true && p.prompt === '聚焦安全性差异', `/mutual custom prompt broken: ${p.prompt}`);

  // ---- explicit /cross ----
  p = parseMessage('/cross @claude <- @chatgpt @deepseek 总结一下分歧');
  assert(p.crossRef === true, '/cross should set crossRef');
  assert(JSON.stringify(p.targetAIs) === JSON.stringify(['claude']), `targets wrong: ${p.targetAIs}`);
  assert(JSON.stringify(p.sourceAIs) === JSON.stringify(['chatgpt', 'deepseek']), `sources wrong: ${p.sourceAIs}`);
  assert(p.originalMessage === '总结一下分歧', `message wrong: ${p.originalMessage}`);

  // /cross without arrow falls back to plain send
  p = parseMessage('/cross hello world');
  assert(p.crossRef === false, '/cross without arrow should degrade to plain');

  // ---- two mentions + evaluation keyword => implicit cross-ref ----
  // First mention = target (evaluates), last mention = source (is evaluated).
  p = parseMessage('@claude 你觉得 @chatgpt 讲的怎么样');
  assert(p.crossRef === true, 'eval keywords should trigger cross-ref');
  assert(p.targetAIs[0] === 'claude', `target should be first mention, got ${p.targetAIs}`);
  assert(p.sourceAIs[0] === 'chatgpt', `source should be last mention, got ${p.sourceAIs}`);

  // ---- two mentions WITHOUT keyword => plain broadcast ----
  p = parseMessage('@claude 和 @chatgpt 你们好');
  assert(p.crossRef === false, 'no eval keyword must stay plain');
  assert(JSON.stringify(p.mentions) === JSON.stringify(['claude', 'chatgpt']), `mentions wrong: ${p.mentions}`);

  // ---- single mention ----
  p = parseMessage('@claude 你好');
  assert(p.crossRef === false && p.mentions.length === 1, 'single mention should be plain targeted send');

  // ---- no mentions ----
  p = parseMessage('大家好');
  assert(p.crossRef === false && p.mentions.length === 0, 'plain message has no mentions');

  // ---- case-insensitive + dedupe ----
  p = parseMessage('@Claude hi @CLAUDE');
  assert(JSON.stringify(p.mentions) === JSON.stringify(['claude']), `dedupe/lowercase failed: ${p.mentions}`);

  console.log('parseMessage tests passed');
})().catch(err => {
  console.error(err);
  process.exit(1);
});
