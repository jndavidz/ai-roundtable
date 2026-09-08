// 豆包: 发测试消息生成回复, 抓助手容器结构
import { pathToFileURL } from "node:url";
import http from "node:http";
const { cdp } = await import(pathToFileURL("D:/repos/aurora/scripts/cdp/cdp-helper.mjs").href);
const tabs = await new Promise((res) => { http.get({ host: '127.0.0.1', port: 9223, path: '/json/list' }, r => { let d=''; r.on('data',c=>d+=c); r.on('end',()=>res(JSON.parse(d))); }); });
const tab = tabs.find(t => t.type === 'page' && t.url.includes('doubao.com'));
if (!tab) { console.log('no doubao tab'); process.exit(1); }
// 激活标签(豆包后台可能不响应输入)
await new Promise((res) => {
  const req = http.get({ host: '127.0.0.1', port: 9223, path: '/json/activate/' + tab.id }, r => { r.resume(); r.on('end', () => res()); });
  req.on('error', () => res()); req.setTimeout(3000, () => { req.destroy(); res(); });
});
const c = await cdp(tab.webSocketDebuggerUrl);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ev = async (e) => (await c.cmd('Runtime.evaluate', { expression: e, returnByValue: true })).result?.result?.value;
const TEXT = '你好，这是扩展结构诊断测试，请回复任意一句话。';

// 1) 找输入框(豆包 contenteditable 或 textarea)
console.log('1 editor:', await ev(`(function(){
  var cands = Array.from(document.querySelectorAll('[contenteditable="true"], textarea')).filter(function (e) { return e.offsetParent; });
  if (!cands.length) return 'NO_EDITOR';
  var ed = cands[cands.length - 1];
  window.__ed = ed;
  return { tag: ed.tagName, cls: String(ed.className || '').slice(0, 40) };
})()`));

// 2) 写入
console.log('2 fill:', await ev(`(function(){
  var ed = window.__ed;
  ed.focus();
  if (ed.tagName === 'TEXTAREA') {
    var setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    setter.call(ed, ${JSON.stringify(TEXT)});
    ed.dispatchEvent(new Event('input', { bubbles: true }));
  } else {
    document.execCommand('selectAll', false, null);
    document.execCommand('delete', false, null);
    document.execCommand('insertText', false, ${JSON.stringify(TEXT)});
  }
  return { text: (ed.innerText || ed.value || '').trim().slice(0, 30) };
})()`));
await sleep(800);

// 3) 发送(Enter + 按钮)
console.log('3 send:', await ev(`(function(){
  var ed = window.__ed;
  var btn = Array.from(document.querySelectorAll('button')).find(function (b) {
    return b.offsetParent && /发送|Send/i.test(b.getAttribute('aria-label') || '');
  });
  if (btn) { btn.click(); return 'BTN_CLICKED'; }
  ed.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
  return 'ENTER_DISPATCHED';
})()`));

// 4) 等回复出现并抓结构
var done = false;
for (let i = 0; i < 20; i++) {
  await sleep(3000);
  const st = await ev(`(function(){
    var boxes = document.querySelectorAll('[class*="md-box-root"]');
    var nonUser = [];
    boxes.forEach(function (b) {
      if (!/gh-user/.test(b.className)) nonUser.push({ cls: String(b.className).slice(0, 50), len: (b.innerText || '').length });
    });
    return JSON.stringify({ total: boxes.length, nonUser: nonUser.slice(-2),
      userCount: document.querySelectorAll('[class*="gh-user"]').length });
  })()`);
  console.log('4 poll', (i + 1) + ':', st);
  const info = JSON.parse(st);
  if (info.nonUser.length && info.nonUser.some(n => n.len > 30)) { done = true; break; }
}

// 5) 抓助手容器结构
if (done) {
  console.log('5 structure:', await ev(`(function(){
    var boxes = document.querySelectorAll('[class*="md-box-root"]:not([class*="gh-user"])');
    var last = boxes[boxes.length - 1];
    var chain = [], n = last;
    for (var i = 0; i < 5 && n; i++) { chain.push(n.tagName + '.' + String(n.className || '').slice(0, 40)); n = n.parentElement; }
    return JSON.stringify({ count: boxes.length, chain: chain,
      textHead: (last.innerText || '').trim().slice(0, 80) }, null, 1);
  })()`));
}
c.close();
