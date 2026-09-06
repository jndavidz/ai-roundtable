import { pathToFileURL } from "node:url";
import http from "node:http";
const { cdp } = await import(pathToFileURL("D:/repos/aurora/scripts/cdp/cdp-helper.mjs").href);
const tabs = await new Promise((res) => { http.get({ host: '127.0.0.1', port: 9223, path: '/json/list' }, r => { let d=''; r.on('data',c=>d+=c); r.on('end',()=>res(JSON.parse(d))); }); });
const tab = tabs.find(t => t.type === 'page' && t.url.includes('doubao.com'));
const c = await cdp(tab.webSocketDebuggerUrl);
const res = await c.cmd('Runtime.evaluate', {
  expression: `(function(){
    var out = { copyBtns: [], groups: [] };
    // 复制按钮(豆包回复操作栏)
    var btns = Array.from(document.querySelectorAll('button, [role="button"], div[class*="icon"]'));
    var copies = btns.filter(function (b) {
      var l = (b.getAttribute('aria-label') || '') + (b.getAttribute('data-testid') || '');
      return /复制|copy/i.test(l) && b.offsetParent;
    });
    out.copyBtns = copies.length;
    // 从复制按钮向上: 找包含回复正文的容器链
    if (copies.length) {
      var b = copies[copies.length - 1];
      var chain = [], n = b, prevText = '';
      for (var i = 0; i < 8 && n; i++) {
        var t = (n.innerText || '').trim();
        chain.push(n.tagName + '.' + String(n.className || '').slice(0, 28) + '[' + t.length + ']');
        n = n.parentElement;
      }
      out.chain = chain;
      // 最后一条助手消息条目候选
      var items = document.querySelectorAll('[class*="message-list"] > div, [class*="message-list"] > [class*="item"]');
      out.listItems = items.length;
      if (items.length) {
        var last = items[items.length - 1];
        out.lastItem = { cls: String(last.className || '').slice(0, 50), textLen: (last.innerText || '').length,
          head: (last.innerText || '').trim().slice(0, 80) };
      }
    }
    return JSON.stringify(out, null, 1);
  })()`,
  returnByValue: true });
console.log(res.result?.result?.value ?? 'none');
c.close();
