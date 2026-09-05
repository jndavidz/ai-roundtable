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
  get textContent() { return this.innerText; }
  set textContent(v) { this._text = String(v); this.children = []; }
  replaceWith(other) {
    if (!this.parent) return;
    const i = this.parent.children.indexOf(this);
    if (i >= 0) this.parent.children.splice(i, 1, other);
    other.parent = this.parent;
  }
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
    querySelector(sel) { return root.querySelector(sel); },
    // Used by extractAnswerText's table→<pre> conversion.
    createElement(tag) { return new FakeEl(tag); }
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

  // Mirror the REAL chatglm.cn page (observed 2026): the answer is rendered as
  // SEVERAL .markdown-body section blocks, all wrapped by an ancestor .answer
  // (which would duplicate everything if captured), plus a thinking block,
  // a mermaid diagram rendered BOTH as source (in <pre>) and as a preview div,
  // and a footer. This exercises the de-duplication fixes.
  function makeSection(text) {
    const md = new FakeEl('div', ['markdown-body']);
    md.innerText = text;
    return md;
  }

  // Ancestor wrapper that contains all the leaf sections (must be SKIPPED).
  const answer = new FakeEl('div', ['answer']);

  const s1 = makeSection([
    '基于对最新社区插件和最佳实践的调研，为 DSH 选择搜索插件……',
    '🏆 核心推荐插件概览',
    '<details> 安装与快速配置：dsh plugin --profile web add @liustack/modsearch </details>'
  ].join('\n'));
  answer.appendChild(s1);

  // ---- comparison TABLE: must be converted to readable pipe rows, not flattened ----
  const table = new FakeEl('table');
  [['插件名称', '核心定位', '引擎支持'],
   ['ModSearch', '功能全面、免费起步', 'Firecrawl, Tavily, Exa'],
   ['dsh-web-search-pro', '企业级', '多引擎']].forEach(cells => {
    const tr = new FakeEl('tr');
    cells.forEach(c => {
      const td = new FakeEl('td');
      td.innerText = c;
      tr.appendChild(td);
    });
    table.appendChild(tr);
  });
  s1.appendChild(table);
  s1.innerText += '\nModSearch @liustack/modsearch 功能全面、免费起步 github.com';

  const s2 = makeSection([
    '✅ 总结 对于绝大多数用户，ModSearch 是最佳起点。',
    '想零成本体验语义搜索，选 dsh-web-search-exa 作为备胎。'
  ].join('\n'));
  answer.appendChild(s2);

  // ---- thinking block (REAL class "text-advance-thinking-content") nested in .answer ----
  if (withThinking) {
    const think = new FakeEl('div', ['answer-content-wrap', 'text-advance-thinking-content']);
    const md = new FakeEl('div', ['markdown-body', 'dr_margin_botttom', 'md-body', 'tl']);
    md.innerText = [
      'Hmm, 用户想为 DeepSeek Harness 找搜索插件……',
      'tencent.com 以及是否需要 API key 这些实际问题。',
      'aliyun.com +1'
    ].join('\n');
    think.appendChild(md);
    answer.appendChild(think);
  }

  // ---- mermaid diagram lives INSIDE a .markdown-body (as on the real page):
  //      SOURCE in <pre> (keep) + rendered PREVIEW div (drop) ----
  const pre = new FakeEl('pre');
  pre.innerText = 'flowchart LR\n A[开始] --> B{需求?}\n B -- 免费 --> C[ModSearch]';
  s2.appendChild(pre);

  const preview = new FakeEl('div', ['mermaid']);
  preview.innerText = '开始需求?免费ModSearch'; // flattened labels — must NOT appear
  s2.appendChild(preview);

  // nested mermaid <style> blob — must NOT leak
  const style = new FakeEl('style');
  style.innerText = '#mmd-1788611910196-3{font-family:"PingFang SC";}@keyframes dash{to{stroke-dashoffset:0;}}';
  s1.appendChild(style);

  root.appendChild(answer);

  // ---- footer: 来源 / 推荐问题 (separate container, should NOT match) ----
  const footer = new FakeEl('div', ['sources-footer']);
  footer.innerText = '20个来源 ModSearch如何配置Tavily和Exa的Key？ 和我聊聊天吧';
  root.appendChild(footer);

  return makeDoc(root);
}

function assert(cond, msg) { if (!cond) throw new Error(msg); }
function count(hay, needle) { return hay.split(needle).length - 1; }

// ---- tests ------------------------------------------------------------------

(async () => {
  // Kimi: full reply ONCE, thinking/mermaid-preview/style excluded, no dup.
  {
    const out = runExtract('content/kimi.js', () => buildScenario({ withThinking: true }));
    assert(out.includes('核心推荐插件概览'), 'kimi: missing answer body (truncated)');
    assert(out.includes('ModSearch'), 'kimi: missing ModSearch in reply');
    assert(out.includes('dsh plugin'), 'kimi: missing <details> install command');
    assert(count(out, '✅ 总结') === 1, 'kimi: reply duplicated (✅ 总结 x' + count(out, '✅ 总结') + ')');
    assert(out.includes('flowchart LR'), 'kimi: missing mermaid SOURCE');
    assert(!out.includes('开始需求?免费ModSearch'), 'kimi: mermaid PREVIEW labels leaked');
    assert(!out.includes('Hmm, 用户想'), 'kimi: thinking block leaked into reply');
    assert(!out.includes('#mmd-'), 'kimi: mermaid <style> CSS leaked into reply');
    // Table must be readable pipe rows, NOT flattened into one run-on line.
    assert(out.includes('| 插件名称 | 核心定位 | 引擎支持 |'), 'kimi: table header row missing');
    assert(out.includes('| ModSearch | 功能全面、免费起步 | Firecrawl, Tavily, Exa |'), 'kimi: table data row missing');
    console.log('kimi aggregation OK (len=' + out.length + ')');
  }

  // GLM: same real-page shape — thinking + mermaid preview + style stripped,
  // answer captured exactly ONCE (no ancestor/duplicate pasting).
  {
    const out = runExtract('content/glm.js', () => buildScenario({ withThinking: true }));
    assert(out.includes('核心推荐插件概览'), 'glm: missing answer body (truncated)');
    assert(out.includes('ModSearch'), 'glm: missing ModSearch in reply');
    assert(out.includes('dsh plugin'), 'glm: missing <details> install command');
    assert(count(out, '✅ 总结') === 1, 'glm: reply duplicated (✅ 总结 x' + count(out, '✅ 总结') + ')');
    assert(out.includes('flowchart LR'), 'glm: missing mermaid SOURCE');
    assert(!out.includes('开始需求?免费ModSearch'), 'glm: mermaid PREVIEW labels leaked');
    assert(!out.includes('Hmm, 用户想'), 'glm: think-block leaked into reply');
    assert(!out.includes('#mmd-'), 'glm: mermaid <style> CSS leaked into reply');
    // The leaked domains lived INSIDE the thinking block, so stripping thinking
    // removes them. (github.com in the answer itself is kept on purpose.)
    assert(!out.includes('tencent.com'), 'glm: thinking-domain tencent.com leaked');
    assert(!out.includes('aliyun.com'), 'glm: thinking-domain aliyun.com leaked');
    assert(!out.includes('20个来源'), 'glm: footer/sources section leaked in');
    assert(out.includes('| 插件名称 | 核心定位 | 引擎支持 |'), 'glm: table header row missing');
    assert(out.includes('| ModSearch | 功能全面、免费起步 | Firecrawl, Tavily, Exa |'), 'glm: table data row missing');
    console.log('glm aggregation OK (len=' + out.length + ', thinking stripped)');
  }

  console.log('kimi/glm aggregation tests passed');
})().catch(err => {
  console.error(err);
  process.exit(1);
});
