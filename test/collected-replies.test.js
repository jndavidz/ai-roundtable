#!/usr/bin/env node

// Tests for panel.js's aggregation helpers: formatCollectedReplies (clipboard
// plain text) and getCheckedTargets (checkbox reading). Needs
// shared/constants.js loaded first for the AI display-name lookup.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');

function loadPanel(checkedIds = []) {
  const checked = new Set(checkedIds);
  const stubElement = (id) => ({
    id,
    value: '',
    checked: id ? checked.has(id) : false,
    addEventListener() {},
    classList: { add() {}, remove() {}, toggle() { return false; } }
  });

  const sandbox = {
    console,
    document: {
      getElementById: (id = '') => stubElement(id),
      querySelectorAll: () => [],
      querySelector: () => null,
      addEventListener() {},
      createElement: () => ({ textContent: '', innerHTML: '' })
    },
    chrome: {
      runtime: { onMessage: { addListener() {} }, sendMessage: () => {} },
      storage: { local: { get: () => {}, set: () => {} } },
      tabs: { query: async () => [] }
    }
  };
  vm.createContext(sandbox);
  const load = (rel, name) => vm.runInContext(
    fs.readFileSync(path.join(ROOT, rel), 'utf8'),
    sandbox,
    { filename: name }
  );
  load('shared/constants.js', 'shared/constants.js');
  load('sidepanel/panel.js', 'sidepanel/panel.js');
  sandbox.__read = expr => vm.runInContext(expr, sandbox);
  return sandbox;
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

(async () => {
  const format = loadPanel().__read('formatCollectedReplies');
  if (typeof format !== 'function') throw new Error('formatCollectedReplies not found');

  // ---- basic multi-model aggregation, checkbox order preserved ----
  const out = format([
    { ai: 'claude', response: '观点 A\n细节 A2' },
    { ai: 'chatgpt', response: '观点 B' }
  ]);
  assert(out === '【Claude】\n观点 A\n细节 A2\n\n【ChatGPT】\n观点 B',
    `unexpected output:\n${out}`);

  // ---- surrounding whitespace is trimmed per reply ----
  const trimmed = format([{ ai: 'glm', response: '\n  内容  \n' }]);
  assert(trimmed === '【智谱】\n内容', `trim failed: '${trimmed}'`);

  // ---- single entry has no separator; empty list yields empty string ----
  assert(format([{ ai: 'kimi', response: 'x' }]) === '【月之暗面】\nx', 'single entry broken');
  assert(format([]) === '', 'empty entries should produce an empty string');

  // ---- unknown aiType falls back to capitalized type name ----
  assert(format([{ ai: 'newai', response: 'y' }]) === '【Newai】\ny', 'fallback naming broken');

  // ---- getCheckedTargets: checkbox order + only checked boxes ----
  const s2 = loadPanel(['target-chatgpt', 'target-doubao']); // chatgpt & doubao checked
  const getChecked = s2.__read('getCheckedTargets');
  if (typeof getChecked !== 'function') throw new Error('getCheckedTargets not found');
  assert(JSON.stringify(getChecked()) === JSON.stringify(['chatgpt', 'doubao']),
    `checked targets wrong: ${JSON.stringify(getChecked())}`);

  // nothing checked → empty list
  const s3 = loadPanel([]);
  assert(s3.__read('getCheckedTargets')().length === 0, 'no checkboxes should yield []');

  console.log('collected replies tests passed');
})().catch(err => {
  console.error(err);
  process.exit(1);
});
