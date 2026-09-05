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

  // Mirror the REAL chatglm.cn page (observed 2026): a thinking block precedes
  // the answer, the answer is one big .markdown-body (with <details> and a
  // mermaid <style> blob), and a "来源 / 推荐问题" footer follows it.
  function makeAnswer(text) {
    const md = new FakeEl('div', ['markdown-body']);
    md.innerText = text;
    return md;
  }

  // ---- thinking block (class think-block) — must be stripped ----
  if (withThinking) {
    const think = new FakeEl('div', ['think-block']);
    think.innerText = [
      'Hmm, 用户想为 DeepSeek Harness 找搜索插件……',
      'tencent.com 以及是否需要 API key 这些实际问题。',
      'aliyun.com +1'
    ].join('\n');
    root.appendChild(think);
  }

  // ---- the actual answer ----
  const answer = makeAnswer([
    '基于对最新社区插件和最佳实践的调研，为 DSH 选择搜索插件……',
    '',
    '🏆 核心推荐插件概览',
    'ModSearch @liustack/modsearch 功能全面、免费起步 github.com',
    '',
    '<details> 安装与快速配置：dsh plugin --profile web add @liustack/modsearch </details>',
    '',
    '✅ 总结 对于绝大多数用户，ModSearch 是最佳起点。'
  ].join('\n'));

  // nested mermaid <style> blob — must NOT leak
  const style = new FakeEl('style');
  style.innerText = '#mmd-1788611910196-3{font-family:"PingFang SC";}@keyframes dash{to{stroke-dashoffset:0;}}';
  answer.appendChild(style);

  // nested mermaid diagram text (real answer content — must be KEPT)
  const mermaid = new FakeEl('div', ['mermaid']);
  mermaid.innerText = '开始选择DSH搜索插件 主要需求是什么？ ModSearch dsh-web-search-pro';
  answer.appendChild(mermaid);

  root.appendChild(answer);

  // ---- footer: 来源 / 推荐问题 (separate container, should NOT match) ----
  const footer = new FakeEl('div', ['sources-footer']);
  footer.innerText = '20个来源 ModSearch如何配置Tavily和Exa的Key？ 和我聊聊天吧';
  root.appendChild(footer);

  return makeDoc(root);
}

function assert(cond, msg) { if (!cond) throw new Error(msg); }

// ---- tests ------------------------------------------------------------------

(async () => {
  // Kimi: full reply must be captured, thinking/mermaid-style excluded.
  {
    const out = runExtract('content/kimi.js', () => buildScenario({ withThinking: true }));
    assert(out.includes('核心推荐插件概览'), 'kimi: missing answer body (truncated)');
    assert(out.includes('ModSearch'), 'kimi: missing ModSearch in reply');
    assert(out.includes('dsh plugin'), 'kimi: missing <details> install command');
    assert(out.includes('开始选择DSH搜索插件'), 'kimi: missing mermaid diagram text');
    assert(!out.includes('Hmm, 用户想'), 'kimi: thinking block leaked into reply');
    assert(!out.includes('#mmd-'), 'kimi: mermaid <style> CSS leaked into reply');
    console.log('kimi aggregation OK (len=' + out.length + ')');
  }

  // GLM: same real-page shape — thinking + mermaid style stripped, answer kept.
  {
    const out = runExtract('content/glm.js', () => buildScenario({ withThinking: true }));
    assert(out.includes('核心推荐插件概览'), 'glm: missing answer body (truncated)');
    assert(out.includes('ModSearch'), 'glm: missing ModSearch in reply');
    assert(out.includes('dsh plugin'), 'glm: missing <details> install command');
    assert(out.includes('开始选择DSH搜索插件'), 'glm: missing mermaid diagram text');
    assert(!out.includes('Hmm, 用户想'), 'glm: think-block leaked into reply');
    assert(!out.includes('#mmd-'), 'glm: mermaid <style> CSS leaked into reply');
    // The leaked domains lived INSIDE the thinking block, so stripping thinking
    // removes them. (github.com in the answer itself is kept on purpose.)
    assert(!out.includes('tencent.com'), 'glm: thinking-domain tencent.com leaked');
    assert(!out.includes('aliyun.com'), 'glm: thinking-domain aliyun.com leaked');
    assert(!out.includes('20个来源'), 'glm: footer/sources section leaked in');
    console.log('glm aggregation OK (len=' + out.length + ', thinking stripped)');
  }

  console.log('kimi/glm aggregation tests passed');
})().catch(err => {
  console.error(err);
  process.exit(1);
});
