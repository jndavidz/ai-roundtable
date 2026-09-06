import { pathToFileURL } from "node:url";
import http from "node:http";
const { cdp } = await import(pathToFileURL("D:/repos/aurora/scripts/cdp/cdp-helper.mjs").href);
const tabs = await new Promise((res) => { http.get({ host: '127.0.0.1', port: 9223, path: '/json/list' }, r => { let d=''; r.on('data',c=>d+=c); r.on('end',()=>res(JSON.parse(d))); }); });
const tab = tabs.find(t => t.type === 'page' && t.url.includes('chatgpt.com'));
console.log('URL:', tab.url);
const c = await cdp(tab.webSocketDebuggerUrl);
const res = await c.cmd('Runtime.evaluate', {
  expression: `(function(){
    // 临时聊天标记: URL /temporary-chat 或 DOM class
    var isTemp = location.pathname.includes('temporary-chat') || !!document.querySelector('[class*="temporary"], [data-testid*="temporary"]');
    // 模型名(顶部或消息上的模型标签)
    var modelEl = document.querySelector('[data-testid="model-switcher-label"], [class*="model-name"], select[data-testid="model-switcher"]');
    var model = modelEl ? (modelEl.innerText || modelEl.value || '').trim().slice(0, 40) : null;
    // 用户消息数 vs 助手消息数
    var userMsgs = document.querySelectorAll('[data-message-author-role="user"]').length;
    var asstMsgs = document.querySelectorAll('[data-message-author-role="assistant"]').length;
    // 自定义指令设置入口状态(不开面板, 只查是否有账号登录)
    var accountBtn = !!document.querySelector('[data-testid="profile-button"], [aria-label*="Profile"], [aria-label*="账户"]');
    return JSON.stringify({ isTemp: isTemp, model: model, userMsgs: userMsgs, asstMsgs: asstMsgs, accountBtn: accountBtn });
  })()`,
  returnByValue: true });
console.log(res.result.result.value);
c.close();
