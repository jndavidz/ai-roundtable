#!/usr/bin/env node

// Tests for content/base.js's latest-reply cache (createController). The
// capture loop's tick recomputes the full DOM serialization every ~500ms and
// is the cache's only writer; GET_LATEST_RESPONSE (split view 800ms poll,
// aggregation, /summary) must serve the cached value inside the freshness
// window instead of re-serializing, and recompute once after expiry.
//
// Driven through the controller's message seam with a counting extractor.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');

function loadBaseWithController(config) {
  let listener = null;
  const sandbox = {
    console,
    setTimeout,
    clearTimeout,
    Node: { ELEMENT_NODE: 1 },
    MutationObserver: class MutationObserver {
      constructor(cb) { this.cb = cb; }
      observe() {}
      disconnect() {}
    },
    document: {
      readyState: 'complete',
      querySelector() { return null; },
      querySelectorAll() { return []; },
      addEventListener() {}
    },
    window: {
      getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1' })
    },
    chrome: {
      runtime: {
        id: 'test-extension-id',
        getManifest: () => ({ version: '1.0.0' }),
        sendMessage: () => {},
        onMessage: { addListener: fn => { listener = fn; } }
      }
    }
  };
  sandbox.window.window = sandbox.window;
  sandbox.window.document = sandbox.document;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'content/base.js'), 'utf8'), sandbox, { filename: 'base.js' });
  sandbox.window.AIPanelBase.createController(config);
  return {
    getLatest: () => {
      let reply;
      listener({ type: 'GET_LATEST_RESPONSE' }, {}, (r) => { reply = r; });
      return reply;
    }
  };
}

(async () => {
  let value = 'first reply';
  let extractions = 0;
  const freshMs = 40;

  const api = loadBaseWithController({
    aiType: 'test',
    name: 'Test',
    replyCacheFreshMs: freshMs,
    getLatestResponse: () => { extractions++; return value; }
  });

  // 1. Cold cache: first read computes once and serves the value.
  const r1 = api.getLatest();
  if (r1.content !== 'first reply') throw new Error('cold read: expected first reply, got ' + r1.content);
  if (extractions !== 1) throw new Error('cold read should extract exactly once, got ' + extractions);

  // 2. Fresh window: a burst of reads (split view poll cadence) must NOT
  //    re-extract — this is the whole point of the cache.
  api.getLatest(); api.getLatest(); api.getLatest();
  if (extractions !== 1) throw new Error('fresh reads should be served from cache, extractions=' + extractions);

  // 3. After expiry: one recompute, and it picks up changed content.
  await new Promise(r => setTimeout(r, freshMs + 30));
  value = 'second reply';
  const r2 = api.getLatest();
  if (r2.content !== 'second reply') throw new Error('expired read: expected second reply, got ' + r2.content);
  if (extractions !== 2) throw new Error('expired read should recompute exactly once, extractions=' + extractions);

  // 4. A writer call keeps the cache warm for subsequent readers without the
  //    reader recomputing (tick/poll sharing): simulate by reading, then
  //    immediately reading again — second one must hit the cache.
  const before = extractions;
  api.getLatest();
  api.getLatest();
  if (extractions !== before) throw new Error('back-to-back reads after refresh should not recompute');

  // 5. Null reply is served as null (no reply), not ''.
  await new Promise(r => setTimeout(r, freshMs + 30));
  value = null;
  const r3 = api.getLatest();
  if (r3.content !== null) throw new Error('null reply should surface as null, got ' + JSON.stringify(r3.content));

  console.log('reply-cache tests passed');
})().catch(err => {
  console.error(err);
  process.exit(1);
});
