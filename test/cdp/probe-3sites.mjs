#!/usr/bin/env node
// 三站(doubao/minimax/mimo)结构普查: 消息容器/回复区/流式指示器/选择器命中
import { pathToFileURL } from "node:url";
import http from "node:http";
const { cdp } = await import(pathToFileURL("D:/repos/aurora/scripts/cdp/cdp-helper.mjs").href);

const SITES = {
  'doubao.com': {
    selectors: ['[data-testid*="message"]', '[data-testid*="receive"]', '[class*="markdown"]',
      '[class*="message"]', '[class*="answer"]', '[class*="response"]', '[class*="bubble"]'],
    stream: ['[aria-label*="停止"]', '[aria-label*="Stop"]', '[class*="stop-generating"]',
      '[class*="generating"]', '[class*="loading"]']
  },
  'minimax.io': {
    selectors: ['[class*="prose"]', '[class*="markdown"]', '[class*="message"]', '[class*="answer"]', '[class*="response"]'],
    stream: ['[aria-label*="停止"]', '[aria-label*="Stop"]', '[class*="stop-generating"]', '[class*="loading"]']
  },
  'mimo.ai': {
    selectors: ['[class*="markdown"]', '[class*="message"]', '[class*="answer"]', '[class*="response"]'],
    stream: ['button[aria-label*="停止"]', 'button[aria-label*="Stop"]', '[class*="stop-generating"]', '[class*="loading"]']
  }
};
// 域名宽松匹配(站点实际 host 可能不同, /json/list 里找)
const HOST_MATCH = { 'doubao.com': 'doubao', 'minimax.io': 'minimax', 'mimo.ai': 'mimo' };

const tabs = await new Promise((res) => { http.get({ host: '127.0.0.1', port: 9223, path: '/json/list' }, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(JSON.parse(d))); }); });

for (const [host, cfg] of Object.entries(SITES)) {
  const match = HOST_MATCH[host];
  const tab = tabs.find(t => t.type === 'page' && t.url.includes(match));
  if (!tab) { console.log(`\n===== ${host}: 无标签页 =====`); continue; }
  console.log(`\n===== ${host} (${tab.url.slice(0, 55)}) =====`);
  try {
    const c = await cdp(tab.webSocketDebuggerUrl);
    const res = await c.cmd('Runtime.evaluate', {
      expression: `(function(){
        var out = { visibility: document.visibilityState, selectors: [], stream: [], textHead: (document.body.innerText || '').trim().slice(0, 120) };
        // 选择器命中(取最后命中块文本头)
        var sels = ${JSON.stringify(cfg.selectors)};
        sels.forEach(function (sel) {
          try {
            var els = document.querySelectorAll(sel);
            if (els.length) {
              var last = els[els.length - 1];
              out.selectors.push({ sel: sel, n: els.length,
                lastLen: (last.innerText || '').length,
                lastHead: (last.innerText || '').trim().slice(0, 40),
                lastCls: String(last.className || '').slice(0, 36) });
            }
          } catch (e) {}
        });
        // 流式指示器
        var st = ${JSON.stringify(cfg.stream)};
        st.forEach(function (sel) {
          try {
            var els = document.querySelectorAll(sel);
            if (els.length) out.stream.push({ sel: sel, n: els.length, visible: !!els[0].offsetParent });
          } catch (e) {}
        });
        return JSON.stringify(out);
      })()`,
      returnByValue: true });
    const val = res.result?.result?.value;
    if (val) {
      const info = JSON.parse(val);
      console.log('  可见性:', info.visibility, '| 页面头:', info.textHead.slice(0, 60));
      info.selectors.forEach(s => console.log(`  [sel] ${s.sel} n=${s.n} lastLen=${s.lastLen} lastHead="${s.lastHead}" cls="${s.lastCls}"`));
      info.stream.forEach(s => console.log(`  [stream] ${s.sel} n=${s.n} visible=${s.visible}`));
      if (!info.selectors.length) console.log('  (无选择器命中)');
    } else {
      console.log('  RAW:', JSON.stringify(res.result).slice(0, 200));
    }
    c.close();
  } catch (e) { console.log('  ERROR:', e.message); }
}
console.log('\ndone');
