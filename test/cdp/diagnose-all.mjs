#!/usr/bin/env node
// 诊断 8 大模型站点：在 Tabbit(通道2, 9223) 各 AI 标签页上执行与
// ai-roundtable content script 相同的 getLatestResponse 逻辑，
// 报告每站的命中容器、提取文本长度与开头，用于验证/修正选择器。
// 运行: D:\PortableApps\_sys\node\node.exe <this>  (Windows 侧, 读 127.0.0.1:9223)
import { pathToFileURL } from "node:url";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

// 加载真实 content script 源码(测的就是线上要跑的代码, 避免逻辑漂移)
const CONTENT_DIR = "D:/repos/ai-roundtable/content";
const readContent = (f) => fs.readFileSync(path.join(CONTENT_DIR, f), "utf8");
const SITE_FILE = {
  'chatglm.cn': 'glm.js',
  'kimi.com': 'kimi.js',
  'chat.deepseek.com': 'deepseek.js',
  'chatgpt.com': 'chatgpt.js',
  'claude.ai': 'claude.js',
  'gemini.google.com': 'gemini.js',
  'grok.com': 'grok.js',
  'qianwen.com': 'qianwen.js'
};

const PORT = 9223;

function getJSON(pathname) {
  return new Promise((res, rej) => {
    http.get({ host: "127.0.0.1", port: PORT, path: pathname }, (r) => {
      let d = "";
      r.on("data", (c) => (d += c));
      r.on("end", () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } });
    }).on("error", rej);
  });
}

const { cdp } = await import(pathToFileURL("D:/repos/aurora/scripts/cdp/cdp-helper.mjs").href);

// 在页面内装配真实 content script: 提供 boot/base64ToFiles 桩, 捕获 createController
// 传入的 config, 然后调用 config.getLatestResponse(), 并报告命中情况。
function buildExpr(site) {
  const file = SITE_FILE[site];
  if (!file) return null;
  const src = readContent(file);
  // 页面内包装: 伪造 AIPanelBase 以捕获 config
  return `(function () {
    var SRC = ${JSON.stringify(src)};
    var captured = null;
    window.AIPanelBase = {
      boot: function () { return true; },
      base64ToFiles: function () { return []; },
      createController: function (cfg) { captured = cfg; },
      isVisible: function () { return true; },
      sleep: function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); },
      _test: {}
    };
    try { (0, eval)(SRC); } catch (e) {
      return JSON.stringify({ site: ${JSON.stringify(site)}, error: 'content script threw: ' + e.message });
    }
    if (!captured) {
      return JSON.stringify({ site: ${JSON.stringify(site)}, error: 'createController not called' });
    }
    // 未定义 getLatestResponse 的站点复用 base.js 的默认派生: 遍历 responseSelectors
    // 取最后一个匹配块的 innerText
    if (typeof captured.getLatestResponse !== 'function') {
      captured.getLatestResponse = function () {
        var sels = captured.responseSelectors || [];
        for (var i = 0; i < sels.length; i++) {
          var blocks = document.querySelectorAll(sels[i]);
          if (blocks.length > 0) {
            return (blocks[blocks.length - 1].innerText || '').trim();
          }
        }
        return null;
      };
    }
    var out = null;
    try { out = captured.getLatestResponse(); } catch (e) {
      return JSON.stringify({ site: ${JSON.stringify(site)}, error: 'getLatestResponse threw: ' + e.message });
    }
    var final = (out || '').trim();
    return JSON.stringify({
      site: ${JSON.stringify(site)},
      finalLen: final.length,
      head: final.slice(0, 180),
      tail: final.slice(-140),
      hasHmm: /Hmm/.test(final),
      hasMmd: /#mmd-/.test(final),
      hasUserEcho: /请联网搜索最佳实践/.test(final),
      hasPromo: /(旧时光旅客|分享链接下载名片|高峰时段算力不足|升级会员)/.test(final),
      hits: []
    });
  })();`;
}

const AI_TABS = [
  'chatglm.cn', 'kimi.com', 'claude.ai', 'chatgpt.com',
  'gemini.google.com', 'chat.deepseek.com', 'grok.com', 'qianwen.com'
];

const argv = process.argv.slice(2);
const siteArg = (argv.find(a => a.startsWith('--site=')) || '').slice(7);
const printAll = argv.includes('--all');
const wanted = siteArg ? [siteArg] : AI_TABS;

const tabs = await getJSON('/json/list');
const pages = tabs.filter(t => t.type === 'page' && wanted.some(d => (t.url || '').includes(d)));
console.log('found AI tabs:', pages.length);

  for (const tab of pages) {
    const site = wanted.find(d => tab.url.includes(d));
    try {
      const c = await cdp(tab.webSocketDebuggerUrl);
      const expr = buildExpr(site);
    const res = await c.cmd('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: false });
      const val = res.result?.result?.value ?? res.exceptionDetails?.text;
      let info;
      try { info = JSON.parse(val); } catch { info = { site, error: 'parse fail', raw: String(val).slice(0, 300) }; }
      console.log('\n====', site, '====');
      if (info.error) { console.log('ERROR:', info.error, info.raw || ''); }
      else {
        console.log('finalLen:', info.finalLen, '| hasHmm:', info.hasHmm, '| hasMmd:', info.hasMmd, '| hits:', info.hits.length);
        console.log('head:', JSON.stringify(info.head));
        console.log('tail:', JSON.stringify(info.tail));
        for (const h of (printAll ? info.hits : info.hits.slice(0, 6))) {
          console.log(`  sel=${h.sel} cls="${h.cls}" raw=${h.rawLen} clean=${h.cleanLen} wraps=${h.wrapsLeaf} dropped=${h.dropped}`);
        }
      }
      c.close();
    } catch (e) {
      console.log('\n====', site, '====');
      console.log('CDP FAIL:', e.message);
    }
  }
  console.log('\ndone');
