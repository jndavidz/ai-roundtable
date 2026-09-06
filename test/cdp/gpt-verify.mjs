// 新开 ChatGPT 对话, 发送测试问题, 等回复完成后抓取核对格式指令遵守情况
import { pathToFileURL } from "node:url";
import http from "node:http";
const { cdp } = await import(pathToFileURL("D:/repos/aurora/scripts/cdp/cdp-helper.mjs").href);
const tabs = await new Promise((res) => { http.get({ host: '127.0.0.1', port: 9223, path: '/json/list' }, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(JSON.parse(d))); }); });
const tab = tabs.find(t => t.type === 'page' && t.url.includes('chatgpt.com'));
if (!tab) { console.log('no chatgpt tab'); process.exit(1); }
const c = await cdp(tab.webSocketDebuggerUrl);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ev = async (e) => (await c.cmd('Runtime.evaluate', { expression: e, returnByValue: true })).result?.result?.value;

const QUESTION = '请联网搜索最新信息，对比 modsearch 和 dsh-web-search-pro 这两个 DeepSeek Harness 搜索插件的核心差异，给出选型建议与置信度评级。';

// 1) 新开对话
console.log('1 new chat:', await ev(`(function(){
  var link = document.querySelector('a[data-testid="create-new-chat"], a[href="/"]');
  if (link) { link.click(); return 'CLICKED'; }
  location.href = 'https://chatgpt.com/'; return 'NAVIGATED';
})()`));
await sleep(4000);

// 2) 填入问题(ChatGPT 输入框是 contenteditable div, React 需 beforeinput/input)
console.log('2 fill:', await ev(`(function(){
  var ed = document.querySelector('#prompt-textarea, div[contenteditable="true"][id*="prompt"], div.ProseMirror[contenteditable="true"]');
  if (!ed) {
    var eds = Array.from(document.querySelectorAll('div[contenteditable="true"]'));
    ed = eds.find(function (e) { return e.offsetParent; });
  }
  if (!ed) return 'NO_EDITOR';
  ed.focus();
  // React/ProseMirror: 用 execCommand insertText 走完整输入管线
  document.execCommand('insertText', false, ${JSON.stringify(QUESTION)});
  return 'FILLED len=' + (ed.innerText || '').length;
})()`));
await sleep(1200);

// 3) 点发送
console.log('3 send:', await ev(`(function(){
  var btn = document.querySelector('[data-testid="send-button"], button[aria-label*="发送"], button[aria-label*="Send"]');
  if (!btn) return 'NO_SEND';
  var disabled = btn.disabled || btn.getAttribute('aria-disabled') === 'true';
  btn.click();
  return 'CLICKED (was disabled: ' + disabled + ')';
})()`));
await sleep(5000);

// 4) 轮询等回复完成: assistant 消息数增加 + 无停止按钮 + 文本稳定
let lastLen = -1, stable = 0, waited = 0;
let done = false;
for (let i = 0; i < 60; i++) {
  await sleep(4000);
  waited += 4000;
  const st = await ev(`(function(){
    var msgs = document.querySelectorAll('[data-message-author-role="assistant"]');
    var last = msgs[msgs.length - 1];
    var stop = document.querySelector('[data-testid="stop-button"], button[aria-label*="停止"], button[aria-label*="Stop"]');
    return JSON.stringify({ count: msgs.length, len: last ? (last.innerText || '').length : 0,
      streaming: !!stop && stop.offsetParent !== undefined });
  })()`);
  let info; try { info = JSON.parse(st); } catch { continue; }
  if (info.count >= 1 && !info.streaming && info.len > 100 && info.len === lastLen) {
    stable++;
    if (stable >= 2) { done = true; console.log('4 done after ' + (waited / 1000) + 's: msgs=' + info.count + ' len=' + info.len); break; }
  } else { stable = 0; }
  lastLen = info.len;
  if (i % 5 === 0) console.log('  ...waiting ' + (waited / 1000) + 's (len=' + info.len + ' streaming=' + info.streaming + ')');
}
if (!done) { console.log('TIMEOUT waiting for reply (last len=' + lastLen + ')'); c.close(); process.exit(2); }

// 5) 抓取回复
const reply = await ev(`(function(){
  var msgs = document.querySelectorAll('[data-message-author-role="assistant"]');
  return msgs[msgs.length - 1].innerText || '';
})()`);
// 存档供分析
const fs = await import('node:fs');
fs.writeFileSync('D:/repos/ai-roundtable/test/cdp/gpt-new-reply.txt', reply, 'utf8');
console.log('5 reply saved: ' + reply.length + ' chars');

// 6) 格式核对
const checks = {
  'a.无整句加粗(<len/50 的粗体段)': null,
  'b.段落紧凑(无连续多空行)': null,
  'c.流程横向→': null,
  'd.引用链接[名](url)': null,
  'e.置信度评级收尾': null,
  'f.无开场白("好的,我来")': null
};
const boldRuns = (reply.match(/\*\*[^*\n]{25,}\*\*/g) || []).length; // 长粗体段≈整句加粗
checks['a.无整句加粗(<len/50 的粗体段)'] = boldRuns;
checks['b.段落紧凑(无连续多空行)'] = (reply.match(/\n\n\n/g) || []).length;
checks['c.流程横向→'] = (reply.match(/→/) || []).length;
checks['d.引用链接[名](url)'] = (reply.match(/\[[^\]]+\]\(https?:\/\/[^)]+\)/g) || []).length;
checks['e.置信度评级收尾'] = /置信度[:：]?\s*(高|中|低)/.test(reply) ? '有' : '无';
checks['f.无开场白("好的,我来")'] = /好的[,，]?我来|当然[!,，]?让我/.test(reply) ? '违规' : 'OK';
console.log('6 格式核对:', JSON.stringify(checks, null, 1));
console.log('--- 回复 head 500 ---');
console.log(reply.slice(0, 500));
c.close();
