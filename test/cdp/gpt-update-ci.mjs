// 更新 ChatGPT 自定义指令中的流程呈现规则(更强硬、覆盖架构图), 保存并验证
import { pathToFileURL } from "node:url";
import http from "node:http";
const { cdp } = await import(pathToFileURL("D:/repos/aurora/scripts/cdp/cdp-helper.mjs").href);
const tabs = await new Promise((res) => { http.get({ host: '127.0.0.1', port: 9223, path: '/json/list' }, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(JSON.parse(d))); }); });
const tab = tabs.find(t => t.type === 'page' && t.url.includes('chatgpt.com'));
if (!tab) { console.log('no chatgpt tab'); process.exit(1); }
const c = await cdp(tab.webSocketDebuggerUrl);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ev = async (e) => (await c.cmd('Runtime.evaluate', { expression: e, returnByValue: true })).result?.result?.value;

// 1) 打开自定义指令页
console.log('1 route:', await ev(`(function(){ location.hash = '#settings/Personalization'; return 'ok'; })()`));
await sleep(2500);
console.log('1b open:', await ev(`(function(){
  var els = Array.from(document.querySelectorAll('[role="dialog"] a, [role="dialog"] button'));
  var ci = els.find(function (e) { return /自定义指令|Customize/i.test(e.innerText || ''); });
  if (ci) { ci.click(); return 'CI_OPEN'; }
  return 'ALREADY?' ;
})()`));
await sleep(2000);

// 2) 读原值 → 替换流程规则行 → 写回
console.log('2 patch:', await ev(`(function(){
  var tas = Array.from(document.querySelectorAll('[role="dialog"] textarea'));
  var box = tas.find(function (t) { return /风格和语调偏好/.test(t.placeholder || ''); });
  if (!box) return 'NO_BOX';
  var old = box.value || '';
  if (!old.length) return 'EMPTY_BOX';
  // 定位旧的流程规则行(以 "- 流程步骤" 开头的整行)
  var lines = old.split('\\n');
  var idx = lines.findIndex(function (l) { return l.indexOf('流程步骤') >= 0; });
  var NEW_RULES = [
    '- **流程/架构/数据流呈现（最高优先级，覆盖其他格式偏好）**：',
    '  - 禁止用 ASCII 字符画图或竖排：禁止出现 ↓ ▼ │ ├ └ ── 等字符组成的图形，禁止一行一步竖排；',
    '  - 任何调用链、架构层级、处理流水线一律写成一横行，用 → 连接，并列选项用 [A | B | C] 形式，例：DeepSeek Harness → web_search → modsearch → [Firecrawl | Tavily | Exa] → read_page；',
    '  - 仅当存在真正的分支判断且一横行确实写不下时，才用 mermaid flowchart LR 代码块。'
  ].join('\\n');
  if (idx >= 0) lines.splice(idx, 1, NEW_RULES);
  else lines.push(NEW_RULES);
  var next = lines.join('\\n');
  var setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
  setter.call(box, next);
  box.dispatchEvent(new Event('input', { bubbles: true }));
  box.dispatchEvent(new Event('change', { bubbles: true }));
  return 'PATCHED len=' + next.length + ' (old ' + old.length + ', rule line ' + idx + ')';
})()`));
await sleep(2500);

// 3) 保存
console.log('3 save:', await ev(`(function(){
  var dlg = document.querySelector('[role="dialog"]');
  var btns = Array.from(dlg.querySelectorAll('button'));
  var save = btns.find(function (b) {
    var t = (b.innerText || '').trim();
    return /^(保存|Save)$/.test(t) || /保存更改|Save changes/i.test(t);
  });
  if (!save) return 'NO_SAVE_BTN';
  if (/已保存|Saved/.test(save.innerText)) return 'ALREADY_SAVED';
  save.click(); return 'SAVED';
})()`));
await sleep(2500);

// 4) 验证
console.log('4 verify:', await ev(`(function(){
  var tas = Array.from(document.querySelectorAll('[role="dialog"] textarea'));
  var box = tas.find(function (t) { return /风格和语调偏好/.test(t.placeholder || ''); });
  var v = box ? box.value : '';
  return JSON.stringify({ len: v.length,
    hasNewRule: v.indexOf('禁止用 ASCII 字符画图') >= 0,
    hasOldRule: v.indexOf('- 流程步骤') >= 0,
    savedMark: /已保存|Saved/.test((document.querySelector('[role="dialog"]') || {}).innerText || '') });
})()`));

// 5) 关面板
for (let i = 0; i < 2; i++) {
  await c.cmd('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await c.cmd('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await sleep(400);
}
console.log('5 close:', await ev(`(function(){ location.hash = ''; return 'restored'; })()`));
c.close();
