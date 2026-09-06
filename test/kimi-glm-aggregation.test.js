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
    this.nodeType = 1; // Node.ELEMENT_NODE — serializeInline checks this
  }
  // dom-utils 的序列化器遍历 childNodes(真实 DOM 含 TEXT 节点); FakeEl 把文本
  // 存在 _text, 元素子节点在 children — childNodes 返回 children, 叶子元素的
  // 文本由 serializeInline 的叶子兜底(textContent)读取。
  get childNodes() { return this.children; }
  get nodeValue() { return this._text; }
  // dom-utils 序列化器按 tagName(大写) 分派块级处理, 真实 DOM tagName 为大写
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
  // 与 manifest.json 注入顺序一致: 先 dom-utils.js(提供 window.AIPanelDom.toMarkdown
  // 供 extractAnswerText 的 DOM→Markdown 序列化), 再站点适配器
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'content/dom-utils.js'), 'utf8'), sandbox, { filename: 'content/dom-utils.js' });
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

// ---- kimi fixture: CDP 实测真实结构 (kimi.com 2026-09) ---------------------
function buildKimi() {
  const root = new FakeEl('div');
  // 会话列表里含用户消息与助手消息; 只应取助手消息
  const list = new FakeEl('div', ['chat-content-list']);

  const userItem = new FakeEl('div', ['chat-content-item', 'chat-content-item-user']);
  userItem.innerText = '请联网搜索最佳实践和最新信息，推荐用于deepseek harness的搜索插件。';
  list.appendChild(userItem);

  const assistant = new FakeEl('div', ['chat-content-item', 'chat-content-item-assistant']);

  // 工具调用: 摘要部分(应剥离) + tail 里的正文(应保留)
  const rollup = new FakeEl('div', ['toolcall-rollup']);
  const summary = new FakeEl('div', ['toolcall-rollup__part', 'toolcall-flow']);
  summary.innerText = '使用 3 个工具，Select Representative S-Level GitHub Repositories';
  rollup.appendChild(summary);

  const tail = new FakeEl('div', ['toolcall-rollup__tail']);
  const mdContainer = new FakeEl('div', ['markdown-container']);
  // 联网搜索引用卡片(应剥离, 按用户要求只保留分析正文)
  const refBlock = new FakeEl('div', ['pua-ref-renderer', 'pua-ref-article-block']);
  const refCard = new FakeEl('div', ['pua-ref-article-card']);
  refCard.innerText = 'Github GitHub - libinghui55/dsh-tavily-search: Tavily-backed web search 2周前';
  refBlock.appendChild(refCard);
  mdContainer.appendChild(refBlock);
  const md = new FakeEl('div', ['markdown']);
  md.innerText = ['基于对最新插件的调研，推荐如下：',
                  '🏆 核心推荐插件概览',
                  'ModSearch 功能全面、免费起步 github.com',
                  'dsh plugin --profile web add @liustack/modsearch'].join('\n');
  mdContainer.appendChild(md);
  tail.appendChild(mdContainer);
  rollup.appendChild(tail);
  assistant.appendChild(rollup);

  // 噪声: 升级会员推广 + 底部操作区(「引用」)
  const promo = new FakeEl('div', ['upgrade-membership']);
  promo.innerText = '高峰时段算力不足，已切换至 K2.6 快速，升级会员畅用思考模型';
  assistant.appendChild(promo);

  const actions = new FakeEl('div', ['segment-assistant-actions']);
  actions.innerText = '引用';
  assistant.appendChild(actions);

  list.appendChild(assistant);
  root.appendChild(list);
  return makeDoc(root);
}

// ---- glm fixture: CDP 实测真实结构 (chatglm.cn 2026-09) --------------------
function buildGlm({ withThinking = false } = {}) {
  const root = new FakeEl('div');
  const answer = new FakeEl('div', ['answer']);

  if (withThinking) {
    const think = new FakeEl('div', ['answer-content-wrap', 'text-advance-thinking-content']);
    think.innerText = ['Hmm, 用户想为 DeepSeek Harness 找搜索插件……',
                       'tencent.com 以及是否需要 API key 这些实际问题。',
                       'aliyun.com +1'].join('\n');
    answer.appendChild(think);
  }

  // 正文容器: 非 thinking 的 answer-content-wrap, 内含多个 .markdown-body 段落。
  // 真实 DOM 里文本在段落子节点(<p>)而非容器自身 — 序列化器按块级子节点遍历,
  // 因此 fixture 也要把文本放进 <p> 叶子。
  const body = new FakeEl('div', ['answer-content-wrap']);
  const s1 = new FakeEl('div', ['markdown-body']);
  const mkP = (parent, text) => {
    const pEl = new FakeEl('p');
    pEl.innerText = text;
    parent.appendChild(pEl);
    return pEl;
  };
  mkP(s1, '基于对最新社区插件和最佳实践的调研，为 DSH 选择搜索插件……');
  mkP(s1, '🏆 核心推荐插件概览');

  // 对比表格: 必须转成管道行, 不能被 innerText 压成一行
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
  body.appendChild(s1);

  const s2 = new FakeEl('div', ['markdown-body']);
  mkP(s2, '✅ 总结 对于绝大多数用户，ModSearch 是最佳起点。');
  mkP(s2, '想零成本体验语义搜索，选 dsh-web-search-exa 作为备胎。');

  // mermaid: 代码块容器(源码保留, toMarkdown 输出 ```mermaid 围栏)
  // + 渲染预览 svg(serializeInline 跳过 SVG 子树, 其图形 <text> 不进正文)
  const pre = new FakeEl('pre');
  pre.innerText = 'flowchart LR\n A[开始] --> B{需求?}\n B -- 免费 --> C[ModSearch]';
  s2.appendChild(pre);
  const preview = new FakeEl('svg');
  preview.innerText = '开始需求?免费ModSearch';
  s2.appendChild(preview);

  const style = new FakeEl('style');
  style.innerText = '#mmd-1788611910196-3{font-family:"PingFang SC";}@keyframes dash{to{stroke-dashoffset:0;}}';
  s2.appendChild(style);
  body.appendChild(s2);

  answer.appendChild(body);
  root.appendChild(answer);

  // 页脚噪声(独立容器, 不应被抓到)
  const footer = new FakeEl('div', ['sources-footer']);
  footer.innerText = '20个来源 以上内容为 AI 生成，不代表开发者立场 NaN/';
  root.appendChild(footer);
  return makeDoc(root);
}

function assert(cond, msg) { if (!cond) throw new Error(msg); }
function count(hay, needle) { return hay.split(needle).length - 1; }

// ---- tests ------------------------------------------------------------------

(async () => {
  // Kimi: 只取助手消息, 剥离工具摘要/推广/操作区, 保留正文
  {
    const out = runExtract('content/kimi.js', buildKimi);
    assert(out !== null, 'kimi: no content extracted');
    assert(out.includes('核心推荐插件概览'), 'kimi: missing answer body');
    assert(out.includes('dsh plugin --profile web add'), 'kimi: missing install command');
    assert(!out.includes('使用 3 个工具'), 'kimi: tool-call summary leaked');
    assert(!out.includes('高峰时段算力不足'), 'kimi: upgrade promo leaked');
    assert(!out.includes('请联网搜索最佳实践'), 'kimi: user question leaked');
    assert(!out.includes('libinghui55'), 'kimi: search-ref card leaked');
    assert(out.includes('核心推荐插件概览'), 'kimi: analysis body missing after ref strip');
    console.log('kimi aggregation OK (len=' + out.length + ')');
  }

  // GLM: 取正文容器, 剥离 thinking/页脚/mermaid 预览, 表格转管道行
  {
    const out = runExtract('content/glm.js', () => buildGlm({ withThinking: true }));
    assert(out !== null, 'glm: no content extracted');
    assert(out.includes('核心推荐插件概览'), 'glm: missing answer body');
    assert(out.includes('| 插件名称 | 核心定位 | 引擎支持 |'), 'glm: table header row missing');
    assert(out.includes('| ModSearch | 功能全面、免费起步 | Firecrawl, Tavily, Exa |'), 'glm: table data row missing');
    assert(out.includes('flowchart LR'), 'glm: missing mermaid source');
    assert(!out.includes('开始需求?免费ModSearch'), 'glm: mermaid preview labels leaked');
    assert(!out.includes('Hmm, 用户想'), 'glm: thinking leaked');
    assert(!out.includes('tencent.com'), 'glm: thinking-domain tencent.com leaked');
    assert(!out.includes('20个来源'), 'glm: footer leaked');
    assert(!out.includes('#mmd-'), 'glm: mermaid <style> leaked');
    console.log('glm aggregation OK (len=' + out.length + ')');
  }

  console.log('kimi/glm aggregation tests passed');
})().catch(err => {
  console.error(err);
  process.exit(1);
});
