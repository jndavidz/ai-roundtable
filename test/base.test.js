#!/usr/bin/env node

// Tests for content/base.js's unified streaming capture (createCapture).
// Verifies the multi-signal capture: pre-send snapshot diffing, stability
// threshold, and cross-call dedup via the isCapturing guard.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadBase() {
  const messages = [];

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
      getComputedStyle() {
        return { display: 'block', visibility: 'visible', opacity: '1' };
      }
    },
    chrome: {
      runtime: {
        id: 'test-extension-id',
        getManifest: () => ({ version: '1.0.0' }),
        sendMessage: (msg, callback) => {
          messages.push(msg);
          if (callback) callback();
        }
      }
    }
  };
  sandbox.window.window = sandbox.window;
  sandbox.window.document = sandbox.document;

  vm.createContext(sandbox);
  const source = fs.readFileSync(path.join(__dirname, '../content/base.js'), 'utf8');
  vm.runInContext(source, sandbox, { filename: 'base.js' });

  return { base: sandbox.window.AIPanelBase, messages };
}

(async () => {
  const { base, messages } = loadBase();
  if (!base) throw new Error('AIPanelBase was not defined');

  // ---- Test 1: captures NEW content (different from pre-send snapshot) ----
  let latest = 'old response';
  const capture = base._test.createCapture({
    aiType: 'test',
    name: 'Test',
    getLatestResponse: () => latest,
    getStreamingSignal: () => false,
    checkInterval: 10,
    stableThreshold: 2,
    maxWait: 5000
  });

  const p1 = capture.captureResponse({ preSendContent: 'old response' });
  setTimeout(() => { latest = 'new response'; }, 30);
  await p1;

  const captured = messages.filter(m => m.type === 'RESPONSE_CAPTURED');
  if (captured.length !== 1) {
    throw new Error(`expected 1 RESPONSE_CAPTURED, got ${captured.length}`);
  }
  if (captured[0].content !== 'new response') {
    throw new Error(`expected content 'new response', got '${captured[0].content}'`);
  }
  if (captured[0].aiType !== 'test') {
    throw new Error(`expected aiType 'test', got '${captured[0].aiType}'`);
  }

  // ---- Test 2: concurrent captures are deduplicated by the isCapturing guard ----
  const before = messages.filter(m => m.type === 'RESPONSE_CAPTURED').length;
  setTimeout(() => { latest = 'response two'; }, 10);
  await Promise.all([
    capture.captureResponse({ preSendContent: 'new response' }),
    capture.captureResponse({ preSendContent: 'new response' })
  ]);
  const after = messages.filter(m => m.type === 'RESPONSE_CAPTURED').length;
  if (after - before !== 1) {
    throw new Error(`concurrent captures should emit exactly 1 message, emitted ${after - before}`);
  }

  // ---- Test 3: container-count signal + pre-send guard ----
  // Container increase is an early signal, but content identical to the pre-send
  // snapshot must NOT be captured (guard against stale re-capture); the capture
  // should wait until the actual new text appears.
  let count = 1;
  let text3 = 'fixed text';
  const capture2 = base._test.createCapture({
    aiType: 'test2',
    name: 'Test2',
    getLatestResponse: () => text3,
    getStreamingSignal: () => false,
    getMessageCount: () => count,
    checkInterval: 10,
    stableThreshold: 2,
    maxWait: 5000
  });
  const p3 = capture2.captureResponse({ preSendContent: 'fixed text' });
  setTimeout(() => { count = 2; }, 30);        // container count increased, text unchanged
  setTimeout(() => { text3 = 'brand new text'; }, 70); // then the real response renders
  await p3;

  const captured2 = messages.filter(m => m.type === 'RESPONSE_CAPTURED' && m.aiType === 'test2');
  if (captured2.length !== 1) {
    throw new Error(`expected 1 capture for test2, got ${captured2.length}`);
  }
  if (captured2[0].content !== 'brand new text') {
    throw new Error(`expected 'brand new text', got '${captured2[0].content}' — identical pre-send content was captured`);
  }

  console.log('base capture tests passed');
})().catch(err => {
  console.error(err);
  process.exit(1);
});
