// 验证: 精确选择器能删卡片块而保留行内引用角标
import { pathToFileURL } from "node:url";
import http from "node:http";
const { cdp } = await import(pathToFileURL("D:/repos/aurora/scripts/cdp/cdp-helper.mjs").href);
const tabs = await new Promise((res) => { http.get({ host: '127.0.0.1', port: 9223, path: '/json/list' }, r => { let d=''; r.on('data',c=>d+=c); r.on('end',()=>res(JSON.parse(d))); }); });
const tab = tabs.find(t => t.type === 'page' && t.url.includes('kimi.com'));
const c = await cdp(tab.webSocketDebuggerUrl);
const res = await c.cmd('Runtime.evaluate', {
  expression: `(function(){
    var m = document.querySelector('.chat-content-item-assistant');
    // :has 支持
    var hasSupport = false;
    try { m.querySelectorAll('div:has(*)'); hasSupport = true; } catch (e) {}
    // 卡片级 renderer(内含 article 卡片)
    var cardRenderers = m.querySelectorAll('.pua-ref-renderer:has([class*="pua-ref-article"])');
    // 全部 renderer
    var allRenderers = m.querySelectorAll('.pua-ref-renderer');
    // 行内引用角标(不在卡片级 renderer 内)
    var inlineTags = 0;
    m.querySelectorAll('.pua-ref-cite-tag').forEach(function (t) {
      if (!t.closest('.pua-ref-renderer:has([class*="pua-ref-article"])')) inlineTags++;
    });
    var s0 = cardRenderers[0];
    return JSON.stringify({ hasSupport: hasSupport, allRenderers: allRenderers.length,
      cardRenderers: cardRenderers.length, inlineCiteTagsOutsideCards: inlineTags,
      cardSample: s0 ? String(s0.className).slice(0, 60) : null });
  })()`,
  returnByValue: true });
console.log(res.result.result.value);
c.close();
