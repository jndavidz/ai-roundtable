import { pathToFileURL } from "node:url";
import http from "node:http";
const { cdp } = await import(pathToFileURL("D:/repos/aurora/scripts/cdp/cdp-helper.mjs").href);
const tabs = await new Promise((res) => { http.get({ host: '127.0.0.1', port: 9223, path: '/json/list' }, r => { let d=''; r.on('data',c=>d+=c); r.on('end',()=>res(JSON.parse(d))); }); });
const tab = tabs.find(t => t.type === 'page' && t.url.includes('chatgpt.com'));
const c = await cdp(tab.webSocketDebuggerUrl);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ev = async (e) => (await c.cmd('Runtime.evaluate', { expression: e, returnByValue: true })).result?.result?.value;

// 用 hash 路由打开个性化设置
console.log('route:', await ev(`(function(){ location.hash = '#settings/Personalization'; return location.hash; })()`));
await sleep(2500);
// 找自定义指令入口(设置对话框已开)
console.log('toggle:', await ev(`(function(){
  var sw = document.querySelector('[role="dialog"] button[role="switch"], [role="dialog"] [data-testid*="toggle"], [role="dialog"] input[type="checkbox"]');
  var all = Array.from(document.querySelectorAll('[role="dialog"] [role="switch"], [role="dialog"] input[type="checkbox"]'));
  return JSON.stringify({ switches: all.map(function (x) {
    var anc = x.closest('div');
    var ctx = '';
    for (var i = 0; i < 4 && anc; i++) { anc = anc.parentElement; var h = anc && anc.previousElementSibling ? '' : ''; }
    var row = x.closest('div, li, section');
    return { checked: x.getAttribute('aria-checked') || x.checked, nearby: (row ? (row.innerText || '').slice(0, 60) : '') };
  }) });
})()`));
console.log('entries:', await ev(`(function(){
  var els = Array.from(document.querySelectorAll('[role="dialog"] a, [role="dialog"] button, [role="dialog"] [role="menuitem"]'));
  var texts = els.map(function (e) { return (e.innerText || '').trim().slice(0, 20); }).filter(Boolean);
  var ci = els.find(function (e) { return /自定义指令|Customize/i.test(e.innerText || ''); });
  if (ci) { ci.click(); return 'CI_CLICKED'; }
  return 'DIALOG_ITEMS: ' + texts.slice(0, 16).join(' | ');
})()`));
await sleep(2500);
console.log('text:', await ev(`(function(){
  var dlg = document.querySelector('[role="dialog"]');
  var tas = Array.from(document.querySelectorAll('[role="dialog"] textarea'));
  return JSON.stringify({ dialogHead: dlg ? (dlg.innerText || '').slice(0, 150) : null,
    boxes: tas.map(function (t) {
      // 找最近的带标题的祖先, 确定每个框属于哪个板块
      var anc = t, label = '';
      for (var i = 0; i < 6 && anc; i++) {
        anc = anc.parentElement;
        if (!anc) break;
        var h = anc.querySelector('h1,h2,h3,label,legend');
        if (h) { label = (h.innerText || '').trim().slice(0, 40); break; }
      }
      return { label: label, placeholder: (t.placeholder || '').slice(0, 40), value: (t.value || '(空)').slice(0, 500) };
    }) });
})()`));
// Esc 两次关闭
for (let i = 0; i < 2; i++) {
  await c.cmd('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await c.cmd('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await sleep(400);
}
// 恢复 hash
await ev(`(function(){ location.hash = ''; })()`);
console.log('done, panel closed');
c.close();
