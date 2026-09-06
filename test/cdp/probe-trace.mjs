#!/usr/bin/env node
// 对目标元素逐分支追踪 serializeBlock 判定链, 打印每个元素的走向
import { pathToFileURL } from "node:url";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const { cdp } = await import(pathToFileURL("D:/repos/aurora/scripts/cdp/cdp-helper.mjs").href);
const domUtilsSrc = fs.readFileSync(path.join("D:/repos/ai-roundtable/content", "dom-utils.js"), "utf8");

// 从磁盘源码里提取关键正则/常量, 确保和真实运行一致
const EXPR = `
(function () {
  var DOM = ${JSON.stringify(domUtilsSrc)};
  try { delete window.AIPanelDom; } catch (e) { window.AIPanelDom = undefined; }
  (0, eval)(DOM);
  var nodes = document.querySelectorAll('.answer-content-wrap:not(.text-advance-thinking-content)');
  if (!nodes.length) return JSON.stringify({ error: 'no container' });
  var root = nodes[nodes.length - 1];
  var log = [];

  function clsOf(el) {
    return String((el.className && el.className.baseVal !== undefined ? el.className.baseVal : el.className) || '');
  }
  function trace(el, depth) {
    if (depth > 4 || log.length > 40) return;
    var tag = el.tagName, cls = clsOf(el);
    var textLen = (el.innerText || '').trim().length;
    // 逐分支复现 serializeBlock 判定
    var isH = /^H[1-6]$/.test(tag);
    var isTable = tag === 'TABLE';
    var codeHit = tag === 'PRE' || /code-no-artifacts|language-|highlight|code-block|md-code/.test(cls);
    var blockKids = Array.from(el.children).filter(function (c) {
      return ['P','DIV','SECTION','ARTICLE','H1','H2','H3','H4','H5','H6','LI','UL','OL','PRE','BLOCKQUOTE','TABLE','THEAD','TBODY','TR','TH','TD','HR','DETAILS','SUMMARY','FIGURE','FIGCAPTION'].indexOf(c.tagName) >= 0;
    });
    var verdict = codeHit ? 'CODE' : isH ? 'H' : isTable ? 'TABLE'
      : blockKids.length > 0 ? 'RECURSE(' + blockKids.length + ')'
      : 'INLINE(' + textLen + ')';
    log.push('  '.repeat(depth) + '<' + tag + '> cls="' + cls.slice(0, 36) + '" txt=' + textLen + ' -> ' + verdict);
    if (!codeHit && !isH && !isTable) {
      blockKids.slice(0, 12).forEach(function (k) { trace(k, depth + 1); });
    }
    // 对第一个非空 <p> 插桩 serializeInline
    if (!window.__inlinedV2 && tag === 'P' && textLen > 0 && window.AIPanelDom) {
      window.__inlinedV2 = true;
      try {
        var si = typeof window.AIPanelDom.serializeInline === 'function'
          ? window.AIPanelDom.serializeInline(el) : 'NO_FN(' + typeof window.AIPanelDom.serializeInline + ')';
        log.push('      [inline-probe] serializeInline(p) len=' + String(si).length + ' :: ' + JSON.stringify(String(si).slice(0, 60)));
        var kids = [];
        for (var ci = 0; ci < el.childNodes.length; ci++) {
          var ch = el.childNodes[ci];
          kids.push('type=' + ch.nodeType + ' text=' + JSON.stringify(String(ch.nodeValue || '').slice(0, 20)) + ' tag=' + (ch.tagName || '-'));
        }
        log.push('      [inline-probe] childNodes: ' + kids.join(' | '));
      } catch (e2) { log.push('      [inline-probe] THREW: ' + e2.message); }
    }
  }
  trace(root, 0);
  return JSON.stringify({ lines: log });
})();
`;

const tabs = await new Promise((res) => {
  http.get({ host: '127.0.0.1', port: 9223, path: '/json/list' }, r => {
    let d = ''; r.on('data', c => d += c); r.on('end', () => res(JSON.parse(d)));
  });
});
const tab = tabs.find(t => t.type === 'page' && t.url.includes('chatglm.cn'));
if (!tab) { console.log('no chatglm tab'); process.exit(1); }
const c = await cdp(tab.webSocketDebuggerUrl);
const res = await c.cmd('Runtime.evaluate', { expression: EXPR, returnByValue: true });
const raw = res.result?.result?.value;
let info; try { info = JSON.parse(raw); } catch { console.log(String(raw).slice(0, 600)); process.exit(0); }
if (info.error) { console.log('ERROR:', info.error); } else { info.lines.forEach(l => console.log(l)); }
c.close();
