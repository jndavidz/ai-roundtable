// 开新标签 -> 列出 ChatGPT 顶栏按钮 -> 读设置面板自定义指令 -> 关标签
import { pathToFileURL } from "node:url";
import http from "node:http";
const { cdp } = await import(pathToFileURL("D:/repos/aurora/scripts/cdp/cdp-helper.mjs").href);
const openTab = () => new Promise((res) => {
  const req = http.request({ host: '127.0.0.1', port: 9223, path: '/json/new?https://chatgpt.com/', method: 'PUT' }, r => {
    let d = ''; r.on('data', c => d += c); r.on('end', () => { try { res(JSON.parse(d)); } catch { res(null); } });
  });
  req.on('error', () => res(null)); req.end();
});
const closeTab = (id) => new Promise((res) => {
  http.get({ host: '127.0.0.1', port: 9223, path: '/json/close/' + id }, r => { r.on('end', () => res()); });
});
const nt = await openTab();
if (!nt) { console.log('open failed'); process.exit(1); }
const c = await cdp(nt.webSocketDebuggerUrl);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ev = async (e) => (await c.cmd('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true })).result?.result?.value;

// 等页面就绪(最多 20s)
let ready = false;
for (let i = 0; i < 10; i++) {
  await sleep(2000);
  if (await ev(`document.readyState === 'complete' && !!document.querySelector('button')`)) { ready = true; break; }
}
console.log('ready:', ready);
console.log(await ev(`(function(){
  var btns = Array.from(document.querySelectorAll('button, [role="button"], a[aria-label]'));
  var out = [];
  btns.slice(0, 40).forEach(function (b) {
    var label = b.getAttribute('aria-label') || b.getAttribute('data-testid') || (b.innerText || '').trim().slice(0, 18);
    if (label) out.push(label.slice(0, 30));
  });
  return JSON.stringify(out);
})()`));
c.close();
await closeTab(nt.id);
console.log('closed');
