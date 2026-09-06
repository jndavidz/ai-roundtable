// 对 ChatGPT 最后一条 assistant 回复做 DOM 结构层格式核对
import { pathToFileURL } from "node:url";
import http from "node:http";
const { cdp } = await import(pathToFileURL("D:/repos/aurora/scripts/cdp/cdp-helper.mjs").href);
const tabs = await new Promise((res) => { http.get({ host: '127.0.0.1', port: 9223, path: '/json/list' }, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(JSON.parse(d))); }); });
const tab = tabs.find(t => t.type === 'page' && t.url.includes('chatgpt.com'));
const c = await cdp(tab.webSocketDebuggerUrl);
const res = await c.cmd('Runtime.evaluate', {
  expression: `(function(){
    var msgs = document.querySelectorAll('[data-message-author-role="assistant"]');
    var m = msgs[msgs.length - 1];
    if (!m) return JSON.stringify({ error: 'no message' });
    // 整句加粗: strong/b 内文本 >= 25 字
    var longBolds = [];
    m.querySelectorAll('strong, b').forEach(function (s) {
      var t = (s.textContent || '').trim();
      if (t.length >= 25) longBolds.push(t.slice(0, 30));
    });
    var allBolds = m.querySelectorAll('strong, b').length;
    // 链接
    var links = [];
    m.querySelectorAll('a[href]').forEach(function (a) {
      links.push({ text: (a.textContent || '').trim().slice(0, 24), href: a.getAttribute('href').slice(0, 60) });
    });
    // 结构块
    var h = { h1: m.querySelectorAll('h1').length, h2: m.querySelectorAll('h2').length,
              h3: m.querySelectorAll('h3').length, p: m.querySelectorAll('p').length,
              li: m.querySelectorAll('li').length, pre: m.querySelectorAll('pre').length,
              table: m.querySelectorAll('table').length, blockquote: m.querySelectorAll('blockquote').length };
    // 用户消息数(确认是新对话)
    var users = document.querySelectorAll('[data-message-author-role="user"]').length;
    return JSON.stringify({ userMsgs: users, structure: h,
      boldTotal: allBolds, longBoldCount: longBolds.length, longBoldSamples: longBolds.slice(0, 5),
      linkCount: links.length, linkSamples: links.slice(0, 8) }, null, 1);
  })()`,
  returnByValue: true });
console.log(res.result.result.value);
c.close();
