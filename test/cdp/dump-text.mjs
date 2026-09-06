#!/usr/bin/env node
// 打印某站点提取结果的原始行(带行号与长度), 用于定位换行/结构问题。
// 源码注入用普通字符串拼接(非模板字面量): JSON.stringify 输出含反引号时
// 模板字面量会被终止 —— 已踩坑两次, 勿改回模板写法。
import { pathToFileURL } from "node:url";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const { cdp } = await import(pathToFileURL("D:/repos/aurora/scripts/cdp/cdp-helper.mjs").href);
const argv = process.argv.slice(2);
const site = (argv.find(a => a.startsWith('--site=')) || '').slice(7) || 'chatglm.cn';
const SITE_FILE = {
  'chatglm.cn': 'glm.js', 'kimi.com': 'kimi.js', 'chat.deepseek.com': 'deepseek.js',
  'chatgpt.com': 'chatgpt.js', 'claude.ai': 'claude.js', 'gemini.google.com': 'gemini.js',
  'grok.com': 'grok.js', 'qianwen.com': 'qianwen.js',
  'minimax': 'minimax.js', 'mimo': 'mimo.js', 'doubao': 'doubao.js', 'hunyuan': 'hunyuan.js'
};
const src = fs.readFileSync(path.join("D:/repos/ai-roundtable/content", SITE_FILE[site]), "utf8");
const domUtilsSrc = fs.readFileSync(path.join("D:/repos/ai-roundtable/content", "dom-utils.js"), "utf8");

const BODY = [
  'var captured = null;',
  'window.AIPanelBase = {',
  '  boot: function () { return true; }, base64ToFiles: function () { return []; },',
  '  createController: function (c) { captured = c; },',
  '  isVisible: function () { return true; },',
  '  sleep: function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); },',
  '  _test: {}',
  '};',
  // 先加载 dom-utils.js(提供 window.AIPanelDom.toMarkdown), 与 manifest 注入顺序一致
  'try { delete window.AIPanelDom; } catch (e) { window.AIPanelDom = undefined; }',
  'try { (0, eval)(DOM_UTILS_SRC); } catch (e) {}',
  'try { (0, eval)(SRC); } catch (e) { return JSON.stringify({ error: "throw: " + e.message }); }',
  'if (!captured) return JSON.stringify({ error: "no config" });',
  'if (typeof captured.getLatestResponse !== "function") {',
  '  // 与 base.js makeDefaultGetLatestResponse 同构: 优先序列化管线',
  '  captured.getLatestResponse = function () {',
  '    var sels = captured.responseSelectors || [];',
  '    for (var i = 0; i < sels.length; i++) {',
  '      var b = document.querySelectorAll(sels[i]);',
  '      if (!b.length) continue;',
  '      var node = b[b.length - 1];',
  '      if (window.AIPanelDom && window.AIPanelDom.toMarkdown) {',
  '        var clone = node.cloneNode(true);',
  '        clone.querySelectorAll("style, script").forEach(function (el) { el.remove(); });',
  '        (captured.extractNoiseSelectors || []).forEach(function (sel) {',
  '          try { clone.querySelectorAll(sel).forEach(function (el) { el.remove(); }); } catch (e) {}',
  '        });',
  '        var FENCE = String.fromCharCode(96) + String.fromCharCode(96) + String.fromCharCode(96);',
  '        var md = window.AIPanelDom.toMarkdown(clone)',
  '          .replace(/^\\s*\\w*\\s*(表格|复制|下载|代码预览|代码|预览)\\s*$/gmi, "")',
  '          .replace(new RegExp(FENCE + "\\s*\\n+" + FENCE, "g"), "")',
  '          .replace(/\\n{3,}/g, "\\n\\n")',
  '          .trim();',
  '        if (md) return md;',
  '      }',
  '      return (node.innerText || "").trim();',
  '    }',
  '    return null;',
  '  };',
  '}',
  'var out = captured.getLatestResponse() || "";',
  'return JSON.stringify({ text: out });'
].join('\n');

// 普通拼接: 源码 JSON 字面量在非模板上下文中解析安全
const EXPR = '(function () {\n' +
  '  var DOM_UTILS_SRC = ' + JSON.stringify(domUtilsSrc) + ';\n' +
  '  var SRC = ' + JSON.stringify(src) + ';\n' +
  BODY + '\n' +
  '})();';

const tabs = await new Promise((res) => {
  http.get({ host: '127.0.0.1', port: 9223, path: '/json/list' }, r => {
    let d = ''; r.on('data', c => d += c); r.on('end', () => res(JSON.parse(d)));
  });
});
const tab = tabs.find(t => t.type === 'page' && t.url.includes(site));
if (!tab) { console.log('no tab for', site); process.exit(1); }
const c = await cdp(tab.webSocketDebuggerUrl);
const res = await c.cmd('Runtime.evaluate', { expression: EXPR, returnByValue: true });
let info;
try { info = JSON.parse(res.result?.result?.value ?? '{}'); } catch { console.log('RAW:', String(res.result?.result?.value ?? res.result?.exceptionDetails?.text).slice(0, 400)); process.exit(0); }
if (res.result?.exceptionDetails) console.log('PAGE-THREW:', JSON.stringify(res.result.exceptionDetails).slice(0, 300));
if (info.error) { console.log('ERROR:', info.error); }
else {
  const lines = info.text.split('\n');
  console.log('total chars:', info.text.length, '| lines:', lines.length);
  lines.forEach((l, i) => {
    if (i > 200) return;
    console.log(String(i).padStart(3) + ' [' + String(l.length).padStart(3) + '] ' + JSON.stringify(l));
  });
}
c.close();
