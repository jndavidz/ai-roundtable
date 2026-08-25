#!/usr/bin/env node

// Tests for splitview.js session-mode handling: idle placeholder, debate panel
// construction, discussion mode, config-change rebuilds and the finished-
// session retention path. splitview.js only touches the DOM at init time and
// inside render callbacks, so a small stub document is enough.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');

function makeEl() {
  const el = {
    children: [],
    _innerHTML: '',
    className: '',
    textContent: '',
    style: {},
    dataset: {},
    scrollTop: 0,
    scrollHeight: 100,
    clientHeight: 100,
    classList: {
      add() {}, remove() {},
      toggle() { return false; },
      contains() { return false; }
    },
    addEventListener() {},
    appendChild(child) { el.children.push(child); return child; },
    querySelector(sel) {
      // A rendered placeholder is visible iff the current markup contains it
      if (sel === '.sv-placeholder') {
        return el._innerHTML.includes('sv-placeholder') ? makeEl() : null;
      }
      // Return stable fake subtrees for everything else (.sv-turns,
      // .sv-streaming, .sv-panel-body, .sv-panel-status, ...)
      el._subtrees = el._subtrees || {};
      if (!el._subtrees[sel]) el._subtrees[sel] = makeEl();
      return el._subtrees[sel];
    },
    querySelectorAll() { return []; },
    contains() { return true; },
    closest() { return null; }
  };
  Object.defineProperty(el, 'innerHTML', {
    get() { return el._innerHTML; },
    set(v) {
      el._innerHTML = v;
      // Simulate innerHTML wiping previous children
      if (v === '') el.children = [];
      el._subtrees = {};
    }
  });
  return el;
}

function loadSplitview() {
  const grid = makeEl();

  const sandbox = {
    console,
    URL,
    setInterval: () => 0,
    clearInterval: () => {},
    document: {
      readyState: 'complete',
      getElementById(id) {
        if (id === 'sv-grid') return grid;
        return makeEl(); // toolbar badges, refresh button, ...
      },
      createElement() { return makeEl(); },
      addEventListener() {}
    },
    chrome: {
      runtime: { sendMessage: async () => ({ debateStatus: null, responses: {} }) }
    }
  };
  vm.createContext(sandbox);
  const load = (rel) => vm.runInContext(
    fs.readFileSync(path.join(ROOT, rel), 'utf8'),
    sandbox,
    { filename: rel }
  );
  load('shared/constants.js');
  load('sidepanel/personas.js');
  load('sidepanel/splitview.js');
  sandbox.__read = expr => vm.runInContext(expr, sandbox);
  sandbox.__grid = grid;
  return sandbox;
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

(async () => {
  const s = loadSplitview();

  // ---- 1. no published status → idle, no panels ----
  s.__read('handlePollResponse')({ debateStatus: null, responses: {} });
  assert(s.__read('currentMode') === null, 'null status should keep mode null');

  // ---- 2. discussion status without participants → treated as idle ----
  s.__read('handlePollResponse')({
    debateStatus: { mode: 'discussion', active: true, participants: [] },
    responses: {}
  });
  assert(s.__read('currentMode') === null, 'discussion without participants is idle');

  // ---- 3. debate status builds the four role panels ----
  s.__read('handlePollResponse')({
    debateStatus: {
      mode: 'debate',
      active: true,
      currentPhase: 'opening',
      currentRound: 1,
      currentRole: 'ling',
      topic: '测试议题',
      roleAIMap: { ling: 'deepseek', wen: 'glm', mo: 'chatgpt', he: 'claude' },
      customPersonas: {}
    },
    responses: { deepseek: '', glm: '', chatgpt: '', claude: '' }
  });
  assert(s.__read('currentMode') === 'debate', 'debate mode should activate');
  const keys = Object.keys(s.__read('panelState'));
  assert(JSON.stringify(keys) === JSON.stringify(['ling', 'wen', 'mo', 'he']),
    `expected 4 role panels, got ${keys}`);
  const rebuildKeyBefore = s.__read('lastRebuildKey');
  assert(rebuildKeyBefore.length > 0, 'rebuild key should be recorded');

  // ---- 4. same config → no rebuild; changed map → rebuild ----
  s.__read('handlePollResponse')({
    debateStatus: {
      mode: 'debate', active: true, currentPhase: 'rebuttal', currentRound: 2,
      currentRole: 'wen', topic: '测试议题',
      roleAIMap: { ling: 'deepseek', wen: 'glm', mo: 'chatgpt', he: 'claude' },
      customPersonas: {}
    },
    responses: {}
  });
  assert(s.__read('lastRebuildKey') === rebuildKeyBefore, 'unchanged config must not rebuild');

  s.__read('handlePollResponse')({
    debateStatus: {
      mode: 'debate', active: true, currentPhase: 'rebuttal', currentRound: 2,
      currentRole: 'wen', topic: '测试议题',
      roleAIMap: { ling: 'kimi', wen: 'glm', mo: 'chatgpt', he: 'claude' }, // remapped
      customPersonas: {}
    },
    responses: {}
  });
  assert(s.__read('lastRebuildKey') !== rebuildKeyBefore, 'changed roleAIMap must rebuild');

  // ---- 5. finished session (status cleared) retains "hadSession" view ----
  s.__read('handlePollResponse')({ debateStatus: null, responses: {} });
  assert(s.__read('hadSession') === true, 'finished session should be retained, not reset to placeholder');
  assert(s.__read('currentPollInterval') === s.__read('POLL_INTERVAL_IDLE'),
    `polling should drop to idle rate after finish, got ${s.__read('currentPollInterval')}`);

  // ---- 6. a new active session restores fast polling ----
  s.__read('handlePollResponse')({
    debateStatus: {
      mode: 'discussion', active: true, participants: ['claude', 'chatgpt'],
      roundType: 'initial', currentRound: 1
    },
    responses: {}
  });
  assert(s.__read('currentMode') === 'discussion', 'new session should switch mode');
  assert(s.__read('currentPollInterval') === s.__read('POLL_INTERVAL_ACTIVE'),
    'active session should poll fast again');

  console.log('splitview mode tests passed');
})().catch(err => {
  console.error(err);
  process.exit(1);
});
