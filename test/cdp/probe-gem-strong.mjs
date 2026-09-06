import { pathToFileURL } from "node:url";
import http from "node:http";
const { cdp } = await import(pathToFileURL("D:/repos/aurora/scripts/cdp/cdp-helper.mjs").href);
const tabs = await new Promise((res) => { http.get({ host: '127.0.0.1', port: 9223, path: '/json/list' }, r => { let d=''; r.on('data',c=>d+=c); r.on('end',()=>res(JSON.parse(d))); }); });
const tab = tabs.find(t => t.type === 'page' && t.url.includes('gemini.google.com'));
if (!tab) { console.log('no gemini tab'); process.exit(1); }
const c = await cdp(tab.webSocketDebuggerUrl);
const res = await c.cmd('Runtime.evaluate', {
  expression: `(function(){
    var mc = document.querySelectorAll('message-content');
    var m = mc[mc.length - 1];
    if (!m) return JSON.stringify({ error: 'no message-content' });
    var out = { emptyStrong: [], emptyCode: [], logicCtx: [] };
    // 空粗体: strong 内无可见文本
    m.querySelectorAll('strong, b').forEach(function (s) {
      if (!(s.textContent || '').trim()) {
        out.emptyStrong.push({
          outer: s.outerHTML.slice(0, 120),
          parentCls: String(s.parentElement.className || '').slice(0, 40),
          parentTag: s.parentElement.tagName
        });
      }
    });
    // 空行内 code
    m.querySelectorAll('code').forEach(function (k) {
      if (!(k.textContent || '').trim() && k.children.length === 0) {
        out.emptyCode.push({ outer: k.outerHTML.slice(0, 100) });
      }
    });
    // 「逻辑依据」附近的 HTML
    m.querySelectorAll('p, div, li').forEach(function (el) {
      if ((el.textContent || '').indexOf('逻辑依据') >= 0 && el.children.length < 8 && out.logicCtx.length < 2) {
        out.logicCtx.push(el.outerHTML.slice(0, 600));
      }
    });
    return JSON.stringify(out, null, 1);
  })()`,
  returnByValue: true });
console.log(res.result.result.value.slice(0, 2200));
c.close();
