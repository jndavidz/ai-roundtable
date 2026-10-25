#!/usr/bin/env node

// Tests for the ChatGPT 聚合 (aggregation) extractor after the 2026-10 codex
// app-shell DOM rework (CDP-verified 2026-10-26):
//   - data-testid and data-message-author-role are GONE from the conversation
//   - classes are build hashes (Box-qIMv6G …), unusable as anchors
//   - the stable semantic anchors are now:
//       [data-markdown-text-style="assistant-message"]  (reply body container)
//       [data-content-search-unit-key$=":assistant"]    (turn container)
//
// The fix is a fallback chain in content/chatgpt.js responseSelectors. These
// tests run the REAL dom-utils → base → chatgpt stack in a vm sandbox against
// a fake DOM modeled on the CDP capture, driving the controller through its
// message seam (GET_LATEST_RESPONSE), exactly like the background does.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');

// ---- minimal fake DOM --------------------------------------------------------

class FakeEl {
  constructor(tag, classList = []) {
    this.tag = tag;
    this.children = [];
    this.classList = new Set(classList);
    this._text = '';
    this.attributes = {};
    this.nodeType = 1; // Node.ELEMENT_NODE — serializeInline checks this
  }
  get childNodes() { return this.children; }
  get nodeValue() { return this._text; }
  get tagName() { return this.tag.toUpperCase(); }
  get className() { return Array.from(this.classList).join(' '); }
  set className(v) { this.classList = new Set(String(v).split(/\s+/).filter(Boolean)); }
  get textContent() { return this.innerText; }
  set textContent(v) { this._text = String(v); this.children = []; }
  replaceWith(other) {
    if (!this.parent) return;
    const i = this.parent.children.indexOf(this);
    if (i >= 0) this.parent.children.splice(i, 1, other);
    other.parent = this.parent;
  }
  get innerText() {
    const leaves = [];
    if (this._text && this._text.length > 0) leaves.push(this._text);
    walk(this, n => { if (n._text && n._text.length > 0) leaves.push(n._text); });
    return leaves.join('\n');
  }
  set innerText(v) { this._text = String(v); }
  appendChild(c) { this.children.push(c); c.parent = this; return c; }
  get parentElement() { return this.parent; }
  get parentNode() { return this.parent; }
  matches(sel) { return matchSel(this, sel); }
  closest(sel) { let n = this; while (n) { if (matchSel(n, sel)) return n; n = n.parent; } return null; }
  cloneNode() {
    const c = new FakeEl(this.tag, Array.from(this.classList));
    c._text = this._text;
    c.attributes = { ...this.attributes };
    this.children.forEach(ch => c.appendChild(ch.cloneNode()));
    return c;
  }
  remove() {
    if (this.parent) {
      const i = this.parent.children.indexOf(this);
      if (i >= 0) this.parent.children.splice(i, 1);
    }
  }
  querySelectorAll(sel) {
    const out = [];
    walk(this, n => { if (n !== this && matchSel(n, sel)) out.push(n); });
    return out;
  }
  querySelector(sel) {
    const all = this.querySelectorAll(sel);
    return all.length ? all[0] : null;
  }
}

function walk(el, fn) {
  el.children.forEach(c => { fn(c); walk(c, fn); });
}

// Selector subset used by the adapters, extended for the codex-shell anchors:
// '.class', tag, comma groups, and attribute selectors [attr="v"] / [attr^="v"]
// / [attr$="v"] / [attr*="v"] (the last two also cover [class*="v"]).
function matchSel(el, sel) {
  return sel.split(',').map(s => s.trim()).some(part => {
    if (part.startsWith('.')) return el.classList.has(part.slice(1));
    const m = part.match(/^\[([a-zA-Z-]+)([~|^$*]?=)("([^"]*)"|'([^']*)')\]$/);
    if (m) {
      const [, attr, op, , dq, sq] = m;
      const expected = dq !== undefined ? dq : sq;
      const actual = el.attributes[attr];
      if (actual === undefined) return false;
      if (op === '=') return actual === expected;
      if (op === '^=') return actual.startsWith(expected);
      if (op === '$=') return actual.endsWith(expected);
      if (op === '*=') return actual.includes(expected);
      return false;
    }
    return el.tag === part;
  });
}

function makeDoc(root) {
  return {
    _root: root,
    querySelectorAll(sel) { return root.querySelectorAll(sel); },
    querySelector(sel) { return root.querySelector(sel); },
    createElement(tag) { return new FakeEl(tag); }
  };
}

// ---- load the real dom-utils → base → chatgpt stack --------------------------

function loadChatgptStack(doc) {
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
    document: doc,
    window: {
      getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1' })
    },
    chrome: {
      runtime: {
        id: 'test',
        getManifest: () => ({ version: '1.0.0' }),
        sendMessage: () => {},
        onMessage: { addListener: fn => { listener = fn; } }
      }
    }
  };
  sandbox.window.window = sandbox.window;
  sandbox.window.document = doc;
  vm.createContext(sandbox);
  // manifest 注入顺序: dom-utils → base → chatgpt（chatgpt.js 加载即注册
  // observer 并读 document, fixture 必须先就位）
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'content/dom-utils.js'), 'utf8'), sandbox, { filename: 'content/dom-utils.js' });
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'content/base.js'), 'utf8'), sandbox, { filename: 'content/base.js' });
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'content/chatgpt.js'), 'utf8'), sandbox, { filename: 'content/chatgpt.js' });
  return { sandbox, getListener: () => listener };
}

// Drive the controller's message seam exactly like the background does.
function getLatestResponseViaSeam(stack) {
  let reply = null;
  const got = stack.getListener()(
    { type: 'GET_LATEST_RESPONSE' },
    { tab: { id: 1 } },
    (r) => { reply = r; }
  );
  if (!got) throw new Error('listener did not keep the channel open');
  return reply?.content ?? null;
}

// ---- fixtures ----------------------------------------------------------------

// codex app-shell (2026-10, CDP capture): turn containers keyed by role, the
// assistant body inside an explicitly-marked markdown root. User bubble has
// no markdown-text-style at all.
function buildCodexShell() {
  const root = new FakeEl('div');

  const userTurn = new FakeEl('div');
  userTurn.attributes['data-content-search-unit-key'] = 'fallback-turn-0:0:user';
  const userBubble = new FakeEl('div');
  const userP = new FakeEl('p');
  userP.innerText = '帮我规划家庭云端 AI 方案';
  userBubble.appendChild(userP);
  userTurn.appendChild(userBubble);
  root.appendChild(userTurn);

  const aiTurn = new FakeEl('div');
  aiTurn.attributes['data-content-search-unit-key'] = 'fallback-turn-0:2:assistant';
  const group = new FakeEl('div');
  group.attributes['data-chatgpt-selection-message-id'] = '40756277-66bd';
  const mdRoot = new FakeEl('div');
  mdRoot.attributes['data-markdown-text-style'] = 'assistant-message';
  const body = new FakeEl('div', ['my-4']);
  const p1 = new FakeEl('p');
  p1.innerText = '你的现有设备已经具备建设一个「云端 AI + 本地自动化」系统的基础。';
  body.appendChild(p1);
  // 对比表格必须转成管道行(共享序列化器行为)
  const table = new FakeEl('table');
  [['方案', '费用'], ['全本地', '低'], ['云端混合', '中']].forEach(cells => {
    const tr = new FakeEl('tr');
    cells.forEach(c => {
      const td = new FakeEl('td');
      td.innerText = c;
      tr.appendChild(td);
    });
    table.appendChild(tr);
  });
  body.appendChild(table);
  mdRoot.appendChild(body);
  group.appendChild(mdRoot);
  aiTurn.appendChild(group);
  root.appendChild(aiTurn);

  return makeDoc(root);
}

// Pre-rework DOM (≤2026-09): the legacy anchors still work.
function buildLegacyDom() {
  const root = new FakeEl('div');
  const user = new FakeEl('div');
  user.attributes['data-message-author-role'] = 'user';
  user.innerText = '旧版提问';
  const assistant = new FakeEl('div');
  assistant.attributes['data-message-author-role'] = 'assistant';
  const p = new FakeEl('p');
  p.innerText = '旧版助手的完整回答正文。';
  assistant.appendChild(p);
  root.appendChild(user);
  root.appendChild(assistant);
  return makeDoc(root);
}

// Transition-period page where both DOM generations coexist: the new anchor
// must win because it comes first in responseSelectors.
function buildBothGenerations() {
  const root = new FakeEl('div');
  const legacy = new FakeEl('div');
  legacy.attributes['data-message-author-role'] = 'assistant';
  legacy.innerText = '旧一代锚点命中的内容';
  root.appendChild(legacy);

  const mdRoot = new FakeEl('div');
  mdRoot.attributes['data-markdown-text-style'] = 'assistant-message';
  const p = new FakeEl('p');
  p.innerText = '新一代锚点命中的正文';
  mdRoot.appendChild(p);
  root.appendChild(mdRoot);
  return makeDoc(root);
}

function assert(cond, msg) { if (!cond) throw new Error(msg); }

// ---- tests --------------------------------------------------------------------

(async () => {
  // 1. codex shell: new anchors extract the full assistant reply, not the user
  //    turn; tables serialize to pipe rows.
  {
    const stack = loadChatgptStack(buildCodexShell());
    const out = getLatestResponseViaSeam(stack);
    assert(out !== null, 'codex shell: nothing extracted');
    assert(out.includes('你的现有设备已经具备'), 'codex shell: missing reply body');
    assert(out.includes('| 方案 | 费用 |'), 'codex shell: table not serialized as pipe rows');
    assert(!out.includes('帮我规划家庭云端'), 'codex shell: user turn leaked into reply');
    console.log('chatgpt codex-shell extraction OK (len=' + out.length + ')');
  }

  // 2. legacy DOM: the fallback chain still reaches the old anchor.
  {
    const stack = loadChatgptStack(buildLegacyDom());
    const out = getLatestResponseViaSeam(stack);
    assert(out !== null, 'legacy: nothing extracted');
    assert(out.includes('旧版助手的完整回答正文'), 'legacy: missing reply body');
    assert(!out.includes('旧版提问'), 'legacy: user message leaked');
    console.log('chatgpt legacy-DOM fallback OK');
  }

  // 3. both generations on one page: the first selector in the chain wins.
  {
    const stack = loadChatgptStack(buildBothGenerations());
    const out = getLatestResponseViaSeam(stack);
    assert(out !== null, 'both: nothing extracted');
    assert(out.includes('新一代锚点命中的正文'), 'both: new anchor should take priority, got: ' + out);
    assert(!out.includes('旧一代锚点命中的内容'), 'both: legacy anchor should not win');
    console.log('chatgpt anchor priority OK');
  }

  console.log('chatgpt aggregation tests passed');
})().catch(err => {
  console.error(err);
  process.exit(1);
});
