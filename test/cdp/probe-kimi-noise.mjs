import { pathToFileURL } from "node:url";
import http from "node:http";
const { cdp } = await import(pathToFileURL("D:/repos/aurora/scripts/cdp/cdp-helper.mjs").href);
const tabs = await new Promise((res) => { http.get({ host: '127.0.0.1', port: 9223, path: '/json/list' }, r => { let d=''; r.on('data',c=>d+=c); r.on('end',()=>res(JSON.parse(d))); }); });
const tab = tabs.find(t => t.type === 'page' && t.url.includes('kimi.com'));
const c = await cdp(tab.webSocketDebuggerUrl);
const res = await c.cmd('Runtime.evaluate', {
  expression: `(function(){
    var m = document.querySelector('.chat-content-item-assistant');
    var out = {};
    // 工具调用徽标(web_search:3#11 形态)
    m.querySelectorAll('*').forEach(function (el) {
      var own = '';
      for (var i = 0; i < el.childNodes.length; i++) {
        if (el.childNodes[i].nodeType === 3) own += el.childNodes[i].nodeValue;
      }
      if (/web_search:\\d+#\\d+/.test(own) && !out.toolBadge) {
        out.toolBadge = { tag: el.tagName, cls: String(el.className || '').slice(0, 60), outer: el.outerHTML.slice(0, 200) };
      }
    });
    // 「表格 复制」工具栏
    m.querySelectorAll('div,span').forEach(function (el) {
      var t = (el.textContent || '').trim();
      if (t === '表格' && el.children.length === 0 && !out.tableBar) {
        var p = el.parentElement;
        out.tableBar = { tag: p.tagName, cls: String(p.className || '').slice(0, 60), outer: p.outerHTML.slice(0, 250) };
      }
    });
    // 代码块重复: 数 code-no-artifacts / pre
    out.codeBlocks = { pre: m.querySelectorAll('pre').length,
      codeNoArt: m.querySelectorAll('[class*="code-no-artifacts"]').length,
      mdCode: m.querySelectorAll('[class*="md-code"]').length };
    // kimi 安装命令出现次数
    var cnt = (m.textContent || '').split('profile web add @liustack/modsearch@5.10.1').length - 1;
    out.installCmdCount = cnt;
    return JSON.stringify(out, null, 1);
  })()`,
  returnByValue: true });
console.log(res.result?.result?.value ?? 'none');
c.close();
