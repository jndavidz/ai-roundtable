#!/usr/bin/env node

// Tests for background.js getResponseFromContentScript (the GET_RESPONSE
// handler feeding aggregation, /summary, mutual review and the split view):
//   - a dead content script is re-injected and retried via
//     sendMessageToContentScript instead of failing over silently
//   - when the fallback to stored (session) replies does happen, the result
//     is flagged { stale: true } so the side panel can label it as the
//     previous round instead of passing it off as live content
//   - a live tab returns { content } with no stale flag

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');

function loadBackground({ tabs, sendMessage }) {
  const listeners = { runtimeMessage: [], tabsUpdated: [], tabsRemoved: [] };
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
      action: { onClicked: { addListener() {} } },
      sidePanel: { setPanelBehavior() {}, open: async () => {} },
      storage: {
        session: {
          _data: {},
          get: async key => ({ [key]: sandbox.chrome.storage.session._data[key] }),
          set: async obj => Object.assign(sandbox.chrome.storage.session._data, obj),
          remove: async key => delete sandbox.chrome.storage.session._data[key]
        }
      },
      tabs: {
        queryState: tabs,
        query: async () => sandbox.chrome.tabs.queryState,
        create: async () => ({}),
        sendMessage,
        onUpdated: { addListener: fn => listeners.tabsUpdated.push(fn) },
        onRemoved: { addListener: fn => listeners.tabsRemoved.push(fn) }
      },
      scripting: { executeScript: async () => {} }
    }
  };
  vm.createContext(sandbox);
  vm.runInContext(
    fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8'),
    sandbox,
    { filename: 'background.js' }
  );
  return sandbox;
}

const mkTab = (id, url) => ({ id, url, active: true, discarded: false });

(async () => {
  // ---- 1. no tab: stale fallback with reason ----
  {
    const bg = loadBackground({
      tabs: [],
      sendMessage: async () => ({ content: 'never' })
    });
    await bg.chrome.storage.session.set({
      latestResponses: { chatgpt: '上一轮的旧回复' }
    });
    const res = await bg.handleMessage({ type: 'GET_RESPONSE', aiType: 'chatgpt' });
    if (res.content !== '上一轮的旧回复') throw new Error('no-tab: expected stored reply, got ' + res.content);
    if (res.stale !== true) throw new Error('no-tab fallback must be flagged stale');
    if (res.reason !== 'no-tab') throw new Error('no-tab fallback should carry reason=no-tab');
  }

  // ---- 2. dead content script: re-inject + retry, then stale fallback ----
  {
    let injections = 0;
    const bg = loadBackground({
      tabs: [mkTab(7, 'https://chatgpt.com/c/abc')],
      sendMessage: async () => {
        throw new Error('Receiving end does not exist');
      }
    });
    // count re-injections through the scripting stub
    const origExecute = bg.chrome.scripting.executeScript;
    bg.chrome.scripting.executeScript = async (...args) => { injections++; return origExecute(...args); };

    await bg.chrome.storage.session.set({
      latestResponses: { chatgpt: '上一轮的旧回复' }
    });
    const res = await bg.handleMessage({ type: 'GET_RESPONSE', aiType: 'chatgpt' });
    if (res.stale !== true) throw new Error('dead-cs fallback must be flagged stale');
    if (res.content !== '上一轮的旧回复') throw new Error('dead-cs: expected stored reply');
    if (injections < 1) throw new Error('dead content script should have been re-injected (was the bare-sendMessage regression), injections=' + injections);
  }

  // ---- 3. live tab: current content, no stale flag ----
  {
    const bg = loadBackground({
      tabs: [mkTab(7, 'https://chatgpt.com/c/abc')],
      sendMessage: async () => ({ content: '实时的最新回复' })
    });
    const res = await bg.handleMessage({ type: 'GET_RESPONSE', aiType: 'chatgpt' });
    if (res.content !== '实时的最新回复') throw new Error('live: expected live reply, got ' + res.content);
    if (res.stale) throw new Error('live reply must not be flagged stale');
  }

  console.log('get-response tests passed');
})().catch(err => {
  console.error(err);
  process.exit(1);
});
