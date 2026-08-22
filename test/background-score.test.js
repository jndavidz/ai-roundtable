#!/usr/bin/env node

// Tests for background.js tab selection: scoreAITab path bonuses, hostname
// safety and the last-used-tab affinity that keeps a multi-turn debate on the
// same chat session even when window focus changes.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');

function loadBackground() {
  const listeners = { runtimeMessage: [], tabsUpdated: [], actionClicked: [] };
  const sandbox = {
    console,
    setTimeout,
    clearTimeout,
    URL,
    importScripts(relPath) {
      const src = fs.readFileSync(path.join(ROOT, relPath), 'utf8');
      vm.runInContext(src, sandbox, { filename: relPath });
    },
    chrome: {
      runtime: {
        id: 'test-extension-id',
        getManifest: () => ({ version: '0.0.0-test' }),
        sendMessage: async () => {},
        onMessage: { addListener: fn => listeners.runtimeMessage.push(fn) }
      },
      action: { onClicked: { addListener: fn => listeners.actionClicked.push(fn) } },
      sidePanel: {
        setPanelBehavior() {},
        open: async () => {}
      },
      storage: {
        session: {
          _data: {},
          get: async key => ({ [key]: sandbox.chrome.storage.session._data[key] }),
          set: async obj => Object.assign(sandbox.chrome.storage.session._data, obj),
          remove: async key => delete sandbox.chrome.storage.session._data[key]
        }
      },
      tabs: {
        queryState: [],
        query: async () => sandbox.chrome.tabs.queryState,
        create: async () => ({}),
        // Promise-form response used by sendMessageToContentScript / GET_LATEST_RESPONSE
        sendMessage: async () => ({ success: true }),
        onUpdated: { addListener: fn => listeners.tabsUpdated.push(fn) }
      }
    },
    scripting: { executeScript: async () => {} }
  };
  vm.createContext(sandbox);
  vm.runInContext(
    fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8'),
    sandbox,
    { filename: 'background.js' }
  );
  return { sandbox, listeners };
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

(async () => {
  const { sandbox } = loadBackground();

  const mkTab = (overrides = {}) => ({
    id: 1,
    url: 'https://claude.ai/chat/abc',
    active: false,
    discarded: false,
    ...overrides
  });

  // ---- path bonuses ----
  const inChat = sandbox.scoreAITab('claude', mkTab({ url: 'https://claude.ai/chat/abc' }));
  const inNew = sandbox.scoreAITab('claude', mkTab({ url: 'https://claude.ai/new' }));
  const inDesign = sandbox.scoreAITab('claude', mkTab({ url: 'https://claude.ai/design/x' }));
  assert(inDesign === -Infinity, 'claude design surface must never be selected');
  assert(inChat > inNew, `chat path should outrank /new (${inChat} vs ${inNew})`);

  // ---- hostname safety ----
  assert(sandbox.scoreAITab('kimi', mkTab({ url: 'https://evil.com/?r=kimi.com' })) === -Infinity,
    'URL-string host spoofing must not match');
  assert(sandbox.scoreAITab('kimi', mkTab({ url: 'https://notkimi.com/' })) === -Infinity,
    'suffix-in-name hosts must not match');
  assert(sandbox.scoreAITab('glm', mkTab({ url: 'https://www.chatglm.cn/main' })) > -Infinity,
    'www. prefix must be stripped before matching');

  // ---- recency decay ----
  const now = Date.now();
  const fresh = sandbox.scoreAITab('chatgpt', mkTab({
    url: 'https://chatgpt.com/c/1',
    lastAccessed: now - 10 * 1000
  }));
  const stale = sandbox.scoreAITab('chatgpt', mkTab({
    url: 'https://chatgpt.com/c/1',
    lastAccessed: now - 6 * 60 * 1000
  }));
  assert(fresh > stale, `recently accessed tab must score higher (${fresh} vs ${stale})`);

  // ---- findAITab picks the highest-scoring live tab ----
  // /chat/ (+120) beats /new (+100); active tab is only +30.
  sandbox.chrome.tabs.queryState = [
    mkTab({ id: 11, url: 'https://claude.ai/new', active: false }),
    mkTab({ id: 12, url: 'https://claude.ai/chat/deep-session', active: true })
  ];
  const picked = await sandbox.findAITab('claude');
  assert(picked.id === 12, `expected the active /chat/ tab (12), picked ${picked?.id}`);

  // A successful send to tab 12 remembers it as "the" claude tab…
  const sendResult = await sandbox.handleMessage({ type: 'SEND_MESSAGE', aiType: 'claude', message: 'hi' });
  assert(sendResult?.success === true, 'SEND_MESSAGE should succeed against stubbed tab');

  // ---- last-used affinity survives a focus switch ----
  // Now demote tab 12 to an inactive /new tab while tab 11 becomes the active
  // /chat/ tab: natural scoring would switch to 11, but affinity (+200) must
  // keep the debate pinned to the session that already has context (12).
  sandbox.chrome.tabs.queryState = [
    mkTab({ id: 11, url: 'https://claude.ai/chat/other-session', active: true }),
    mkTab({ id: 12, url: 'https://claude.ai/new', active: false })
  ];
  const repicked = await sandbox.findAITab('claude');
  assert(repicked.id === 12, `affinity should pin the remembered tab (12), got ${repicked?.id}`);

  console.log('background tab-selection tests passed');
})().catch(err => {
  console.error(err);
  process.exit(1);
});
