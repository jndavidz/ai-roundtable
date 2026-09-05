#!/usr/bin/env node

// Tests for the 聚合 (collected-replies) fix on Kimi and GLM content scripts.
//
// Repro from the bug report: when using 聚合, Kimi and GLM replies were
// truncated/garbled. Root cause was getLatestResponse returning the LAST DOM
// node matching a broad selector — which, on these sites, is a partial/
// secondary node (citation footer, secondary bubble, stray trailing wrapper)
// rather than the full answer.
//
// The fix scopes to the LAST non-empty message/answer container and joins every
// content block inside it. This test builds a tiny fake DOM that reproduces a
// full multi-section reply plus trailing citation/secondary noise, and asserts
// the extractor returns the COMPLETE reply.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');

// ---- minimal fake DOM -------------------------------------------------------

class FakeEl {
  constructor(tag, classList = []) {
    this.tag = tag;
    this.children = [];
    this.classList = new Set(classList);
    this._text = '';
    this.attributes = {};
  }
  get className() { return Array.from(this.classList).join(' '); }
  set className(v) { this.classList = new Set(String(v).split(/\s+/).filter(Boolean)); }
  get innerText() {
    // Real browsers compute innerText recursively over descendants. Our fake
    // DOM stores text per-node, so aggregate it here (newline-joined) to mimic
    // browser behavior closely enough for the aggregation tests. Include this
    // node's own text as well as every descendant's.
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

// Support the small subset of selectors used by the adapters:
//   '.class', '[class*="x"]', tag, and comma groups.
function matchSel(el, sel) {
  return sel.split(',').map(s => s.trim()).some(part => {
    if (part.startsWith('.')) return el.classList.has(part.slice(1));
    if (part.startsWith('[class*="') && part.endsWith(']')) {
      // [class*="needle"]  ->  drop the 9-char prefix and the trailing `"]`
      const needle = part.slice('[class*="'.length, -2);
      return Array.from(el.classList).some(c => c.includes(needle));
    }
    if (part.startsWith('[data-type="') && part.endsWith(']')) {
      const v = part.slice('[data-type="'.length, -2);
      return el.attributes['data-type'] === v;
    }
    return el.tag === part;
  });
}

function makeDoc(root) {
  return {
    _root: root,
    querySelectorAll(sel) { return root.querySelectorAll(sel); },
    querySelector(sel) { return root.querySelector(sel); }
  };
}

// ---- load an adapter and extract its getLatestResponse ----------------------

function loadAdapter(rel) {
  const sandbox = {
    console,
    document: null, // set per-case
    window: {
      getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1' })
    },
    chrome: {
      runtime: {
        id: 'test',
        getManifest: () => ({ version: '1.0.0' }),
        sendMessage: () => {},
        onMessage: { addListener() {} }
      }
    }
  };
  sandbox.window.AIPanelBase = {
    boot: () => true,
    createController: (cfg) => { sandbox.__cfg = cfg; }
  };
  sandbox.window.window = sandbox.window;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(ROOT, rel), 'utf8'), sandbox, { filename: rel });
  return sandbox;
}

function runExtract(adapter, buildDoc) {
  const sandbox = loadAdapter(adapter);
  const doc = buildDoc();
  sandbox.document = doc;
  sandbox.window.document = doc;
  // createController stored the config; call its getLatestResponse
  return sandbox.__cfg.getLatestResponse();
}

// ---- shared DOM factory: full reply + trailing noise ------------------------

function buildScenario({ withThinking = false } = {}) {
  const root = new FakeEl('div');

  // The REAL bug report shows the GLM answer is split across MULTIPLE message
  // containers (a streamed / multi-block reply). Previously only the trailing
  // container was captured, truncating the reply. So we model two message blocks.
  function makeMessage(text) {
    const message = new FakeEl('div', ['message', 'assistant']);
    const chatContent = new FakeEl('div', ['chat-content']);
    const md = new FakeEl('div', ['markdown']);
    md.innerText = text;
    chatContent.appendChild(md);
    message.appendChild(chatContent);
    return { message, md };
  }

  const m1 = makeMessage([
    '核心结论：推荐 A 与 B。',
    '',
    '一、按场景的快速推荐',
    '1. 场景 X → 方案 A',
    '2. 场景 Y → 方案 B'
  ].join('\n'));
  root.appendChild(m1.message);

  const m2 = makeMessage([
    '二、逐个插件深度分析',
    '插件 1 的细节……',
    '插件 2 的细节……'
  ].join('\n'));
  root.appendChild(m2.message);

  // a nested content sub-block inside the first message (sites nest this way)
  const content = new FakeEl('div', ['content']);
  content.innerText = '补充说明：注意成本。';
  m1.md.appendChild(content);

  // ---- noise that previously leaked into innerText ----
  // A separate "引用 / references" sidebar whose anchors leak domain names.
  // It must NOT appear in the aggregated reply.
  const refs = new FakeEl('div', ['references', '引用']);
  refs.innerText = 'tencent.com aliyun.com github.com toutiao.com';
  root.appendChild(refs);

  // A stray secondary bubble that matches [class*="response"].
  const secondary = new FakeEl('div', ['response']);
  secondary.innerText = '+1';
  root.appendChild(secondary);

  if (withThinking) {
    const think = new FakeEl('div', ['thinking']);
    think.attributes['data-type'] = 'thinking';
    think.innerText = '（这是思维链，不应出现在聚合结果里）';
    m1.md.appendChild(think);
  }

  return makeDoc(root);
}

function assert(cond, msg) { if (!cond) throw new Error(msg); }

// ---- tests ------------------------------------------------------------------

(async () => {
  // Kimi: full reply must be captured, trailing citations/+1 excluded.
  {
    const out = runExtract('content/kimi.js', () => buildScenario());
    assert(out.includes('核心结论'), 'kimi: missing 核心结论 (truncated)');
    assert(out.includes('逐个插件深度分析'), 'kimi: missing 深度分析 section');
    assert(out.includes('补充说明：注意成本'), 'kimi: missing nested content block');
    assert(!out.includes('tencent.com'), 'kimi: leaked citation domains into reply');
    assert(!out.includes('+1'), 'kimi: captured stray secondary node');
    console.log('kimi aggregation OK (len=' + out.length + ')');
  }

  // GLM: full reply + thinking stripped, citations excluded.
  {
    const out = runExtract('content/glm.js', () => buildScenario({ withThinking: true }));
    assert(out.includes('核心结论'), 'glm: missing 核心结论 (truncated)');
    assert(out.includes('逐个插件深度分析'), 'glm: missing 深度分析 section');
    assert(!out.includes('思维链'), 'glm: thinking block leaked into reply');
    assert(!out.includes('tencent.com'), 'glm: leaked citation domains into reply');
    assert(!out.includes('+1'), 'glm: captured stray secondary node');
    console.log('glm aggregation OK (len=' + out.length + ', thinking stripped)');
  }

  console.log('kimi/glm aggregation tests passed');
})().catch(err => {
  console.error(err);
  process.exit(1);
});
