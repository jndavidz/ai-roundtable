#!/usr/bin/env node

// Tests for background.js tab selection: scoreAITab path bonuses, hostname
// safety and the last-used-tab affinity that keeps a multi-turn debate on the
// same chat session even when window focus changes.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');

function loadBackground({ presetSession } = {}) {
  const listeners = { runtimeMessage: [], tabsUpdated: [], tabsRemoved: [], actionClicked: [] };
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
          _data: { ...(presetSession || {}) },
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
        onUpdated: { addListener: fn => listeners.tabsUpdated.push(fn) },
        onRemoved: { addListener: fn => listeners.tabsRemoved.push(fn) }
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
  const { sandbox, listeners } = loadBackground();

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

  // …and the pin is mirrored into session storage so an SW restart (idle
  // timeout) doesn't silently drop it mid-debate.
  assert(sandbox.chrome.storage.session._data.lastUsedTabIdByAI?.claude === 12,
    'affinity should be persisted to storage.session');

  // ---- last-used affinity survives a focus switch ----
  // Now demote tab 12 to an inactive /new tab while tab 11 becomes the active
  // /chat/ tab: natural scoring would switch to 11, but affinity (+200) must
  // keep the debate pinned to the session that already has context (12).
  sandbox.chrome.tabs.queryState = [
    mkTab({ id: 11, url: 'https://claude.ai/chat/other-session', active: true }),
    mkTab({ id: 12, url: 'https://claude.ai/new', active: false })
  ];
  // The shared tabs snapshot would still serve the previous enumeration —
  // drop it so this lookup scores the (new) live state.
  sandbox.invalidateTabsSnapshot();
  const repicked = await sandbox.findAITab('claude');
  assert(repicked.id === 12, `affinity should pin the remembered tab (12), got ${repicked?.id}`);

  // ---- shared tabs snapshot: a burst of lookups costs one enumeration ----
  // The side panel opens with 13 parallel CHECK_CONNECTION probes and the
  // split view polls every 800ms; every findAITab used to re-enumerate ALL
  // tabs (O(13×N) per panel open). Within the TTL they must share one query.
  let queryCalls = 0;
  const origQuery = sandbox.chrome.tabs.query;
  sandbox.chrome.tabs.query = async (...args) => { queryCalls++; return origQuery(...args); };
  sandbox.invalidateTabsSnapshot();
  await sandbox.findAITab('claude');
  await sandbox.findAITab('kimi');
  await sandbox.findAITab('chatgpt');
  await sandbox.findAITabForReset('glm');
  assert(queryCalls === 1, `burst of lookups should share one tabs.query, got ${queryCalls}`);
  sandbox.invalidateTabsSnapshot();
  await sandbox.findAITab('claude');
  assert(queryCalls === 2, `invalidation must force a fresh enumeration, got ${queryCalls}`);
  // The tab-event listeners keep the snapshot from going stale in production.
  assert(listeners.tabsRemoved.length === 1, 'onRemoved listener should be registered');
  assert(listeners.tabsUpdated.length === 1, 'onUpdated listener should be registered');

  // ---- affinity survives an SW restart via storage.session ----
  // loadAffinity() runs fire-and-forget at load time; a fresh sandbox (= SW
  // waking up after its ~30s idle timeout) with the pin already in session
  // storage must restore it, so a long debate keeps its pinned session.
  {
    const bg2 = loadBackground({ presetSession: { lastUsedTabIdByAI: { claude: 12 } } });
    // let the fire-and-forget loadAffinity() settle
    await new Promise(r => setTimeout(r, 10));
    bg2.sandbox.chrome.tabs.queryState = [
      mkTab({ id: 11, url: 'https://claude.ai/chat/other-session', active: true }),
      mkTab({ id: 12, url: 'https://claude.ai/new', active: false })
    ];
    const afterRestart = await bg2.sandbox.findAITab('claude');
    assert(afterRestart.id === 12,
      `affinity should be restored from storage.session after SW restart, got ${afterRestart?.id}`);
  }

  console.log('background tab-selection tests passed');
})().catch(err => {
  console.error(err);
  process.exit(1);
});
