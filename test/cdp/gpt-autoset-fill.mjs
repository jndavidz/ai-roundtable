// 自动填入 ChatGPT 自定义指令(第2阶段): 偏好框填文本 + 保存 + 验证 + 关面板
// 前置: gpt-autoset.mjs 已打开「启用自定义」开关(true)
import { pathToFileURL } from "node:url";
import http from "node:http";
const { cdp } = await import(pathToFileURL("D:/repos/aurora/scripts/cdp/cdp-helper.mjs").href);
const tabs = await new Promise((res) => { http.get({ host: '127.0.0.1', port: 9223, path: '/json/list' }, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(JSON.parse(d))); }); });
const tab = tabs.find(t => t.type === 'page' && t.url.includes('chatgpt.com'));
if (!tab) { console.log('no chatgpt tab'); process.exit(1); }
const c = await cdp(tab.webSocketDebuggerUrl);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ev = async (e) => (await c.cmd('Runtime.evaluate', { expression: e, returnByValue: true })).result?.result?.value;

const INSTRUCTIONS = [
  '# 语言与态度',
  '- 始终使用中文回复（专有名词、命令行、代码保留英文）。',
  '- 保持绝对客观：不迎合、不谄媚；我的提问前提有误时直接指出，先纠错再回答。',
  '- 遇到不确定的概念或时效性信息（版本号、价格、近期事件），必须联网搜索核实后再回答，不得凭记忆编造。',
  '',
  '# 思考协议（回答前内部执行，不输出推理过程）',
  '1. 第一性原理：先拆解问题的本质核心，识别我真正想要的结果。',
  '2. 多视角推演（仅复杂问题）：以 2-3 个相关领域专家的视角分别推演，综合提炼共识，注明分歧点。',
  '3. 批判性评估：任何方案必须给出「优势」与「劣势/风险」两面。',
  '4. 概率表达：禁止「大概率」「可能吧」等模糊词；给出置信度评级（高/中/低），仅在确有数据时给具体百分比，否则说明估算依据。',
  '',
  '# 输出格式',
  '- 用 Markdown 组织：## 分节；**加粗**只标真正的关键词，禁止整句加粗。',
  '- 标题规则：回答超过约 300 字或确需分节时才用 ##，短回答直接给正文。',
  '- 紧凑原则：相关内容合并成连续段落，不要每句一段；段落间单空行；列表项紧挨着，不要项间插空行。',
  '- 流程步骤横向书写，用 → 连接成一行；有分支或判断的流程才用 mermaid flowchart LR 代码块，禁止逐行↓竖排。',
  '- 对比类内容优先用表格。',
  '- 引用来源用 [来源名](链接) 的 Markdown 链接格式，不要贴裸域名。',
  '',
  '# 开场与收尾',
  '- 禁止「好的，我来帮你」式开场白；禁止复述我的问题，直接给答案。',
  '- 结尾不要「希望对你有帮助」式空话；信息不足时用一句话说明缺什么，不要反问串场。',
  '',
  '# 自检（输出前逐条过）',
  '- 是否偏离我的问题主题？',
  '- 事实性陈述是否有来源支撑？无法核实的是否已标注不确定？',
  '- 逻辑链条是否闭环——结论能否从前提推出？'
].join('\n');

// 1) 确保还在个性化设置页(hash 路由, 幂等)
console.log('1 route:', await ev(`(function(){ location.hash = '#settings/Personalization'; return 'ok'; })()`));
await sleep(2500);

// 2) 填入指令(React 受控 textarea: native setter + input event)
console.log('2 fill:', await ev(`(function(){
  var tas = Array.from(document.querySelectorAll('[role="dialog"] textarea'));
  var box = tas.find(function (t) { return /风格和语调偏好|行为、风格/.test(t.placeholder || ''); });
  if (!box) return 'NO_BOX: ' + tas.map(function (t) { return (t.placeholder || '').slice(0, 20); }).join('|');
  var setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
  setter.call(box, ${JSON.stringify(INSTRUCTIONS)});
  box.dispatchEvent(new Event('input', { bubbles: true }));
  box.dispatchEvent(new Event('change', { bubbles: true }));
  return 'FILLED len=' + box.value.length;
})()`));
await sleep(3000);

// 3) 找保存按钮(若存在非「已保存」态则点击)
console.log('3 save:', await ev(`(function(){
  var dlg = document.querySelector('[role="dialog"]');
  var btns = Array.from(dlg.querySelectorAll('button'));
  var save = btns.find(function (b) {
    var t = (b.innerText || '').trim();
    return /^(保存|Save)$/.test(t) || /保存更改|Save changes/i.test(t) || /保存/.test(b.getAttribute('aria-label') || '');
  });
  if (!save) return 'NO_SAVE_BTN(可能自动保存), 尾部按钮: ' + btns.slice(-4).map(function (b) { return (b.innerText || b.getAttribute('aria-label') || '').trim().slice(0, 12); }).join('|');
  if (/已保存|Saved/.test(save.innerText)) return 'ALREADY_SAVED';
  save.click(); return 'SAVE_CLICKED';
})()`));
await sleep(3000);

// 4) 读回验证
console.log('4 verify:', await ev(`(function(){
  var tas = Array.from(document.querySelectorAll('[role="dialog"] textarea'));
  var box = tas.find(function (t) { return /风格和语调偏好/.test(t.placeholder || ''); });
  var dlg = document.querySelector('[role="dialog"]');
  var mark = dlg ? (dlg.innerText.match(/已保存|Saved/g) || []).length : 0;
  return JSON.stringify({ boxLen: box ? box.value.length : -1,
    head: box ? box.value.slice(0, 40) : null,
    tail: box ? box.value.slice(-40) : null,
    savedMarks: mark });
})()`));

// 5) Esc 关闭面板并恢复 hash
for (let i = 0; i < 2; i++) {
  await c.cmd('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await c.cmd('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await sleep(400);
}
console.log('5 close:', await ev(`(function(){ location.hash = ''; return 'hash cleared, panel closed'; })()`));
c.close();
