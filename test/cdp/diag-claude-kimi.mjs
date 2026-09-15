#!/usr/bin/env node
// Claude incognito 状态 + kimi 重复消息全景
import { pathToFileURL } from "node:url";
import http from "node:http";
const { cdp } = await import(pathToFileURL("D:/repos/aurora/scripts/cdp/cdp-helper.mjs").href);
const tabs = await new Promise((res) => { http.get({ host: '127.0.0.1', port: 9223, path: '/json/list' }, r => { let d=''; r.on('data',c=>d+=c); r.on('end',()=>res(JSON.parse(d))); }); });

// Claude
const cl = tabs.find(t => t.type === 'page' && t.url.includes('claude.ai'));
if (cl) {
  console.log('===== Claude =====');
  console.log('  URL:', cl.url, '| title:', (cl.title || '').slice(0, 40));
  const c = await cdp(cl.webSocketDebuggerUrl);
  const res = await c.cmd('Runtime.evaluate', {
    expression: `(function(){
      var incog = /incognito/.test(location.href) || !!document.querySelector('[class*="incognito"], [data-testid*="incognito"]');
      var banner = '';
      document.querySelectorAll('div,span').forEach(function (el) {
        var t = (el.innerText || '').trim();
        if (!banner && t.length < 80 && /隐身|incognito|不保存|不会保存/i.test(t)) banner = t;
      });
      var users = document.querySelectorAll('[data-testid="user-message"], [class*="user-message"], [data-testid*="user"]');
      var lastUser = users.length ? (users[users.length - 1].innerText || '').trim().slice(0, 45) : null;
      return JSON.stringify({ href: location.href, incognito: incog, banner: banner,
        userCount: users.length, lastUser: lastUser }, null, 1);
    })()`,
    returnByValue: true });
  console.log(res.result?.result?.value ?? 'none');
  c.close();
}

// kimi: 全页搜含特征文本的元素, 统计重复消息
const km = tabs.find(t => t.type === 'page' && t.url.includes('kimi.com') && t.url.includes('/chat/'));
if (km) {
  console.log('\n===== kimi 重复消息全景 =====');
  const c = await cdp(km.webSocketDebuggerUrl);
  const res = await c.cmd('Runtime.evaluate', {
    expression: `(function(){
      var hits = [];
      document.querySelectorAll('*').forEach(function (el) {
        var own = '';
        for (var i = 0; i < el.childNodes.length; i++) {
          if (el.childNodes[i].nodeType === 3) own += el.childNodes[i].nodeValue;
        }
        if (/群晖DS416play/.test(own)) {
          // 只记"最小的"承载者
          var hasChildSame = false;
          Array.prototype.forEach.call(el.children, function (ch) {
            if (/群晖DS416play/.test(ch.textContent || '')) hasChildSame = true;
          });
          if (!hasChildSame) hits.push({ tag: el.tagName, cls: String(el.className || '').slice(0, 46),
            len: own.trim().length, text: own.trim().slice(0, 45) });
        }
      });
      // 助手回复数量
      var asst = document.querySelectorAll('[class*="chat-content-item-assistant"]');
      var segUser = document.querySelectorAll('[class*="segment-user"]');
      return JSON.stringify({ textHits: hits, assistantCount: asst.length, segmentUserCount: segUser.length }, null, 1);
    })()`,
    returnByValue: true });
  console.log(res.result?.result?.value ?? 'none');
  c.close();
}
console.log('done');
