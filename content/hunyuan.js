// AI Panel - Hunyuan (Tencent Yuanbao) Content Script
// URL: https://yuanbao.tencent.com/
// Login required (WeChat / QQ / phone number)
// Input: textarea or div[contenteditable] (Tencent Design components)
// Send: button or a[aria-label*="发送"] (TDesign button system)

(function() {
  'use strict';

  const AI_TYPE = 'hunyuan';
  if (!window.AIPanelBase?.boot(AI_TYPE)) return;

  // 临时对话态的判定(单一来源): URL 参数 **或** 页面标题。
  // 实测坑: 元宝处于临时会话时 URL 往往不带 ?chatMode=temp(形如
  // /chat/<agent>/<cid>)，只有 document.title 是「临时对话」—— 只查 URL
  // 会漏判，正是「修复后仍发进临时对话」的根因。
  function isTempState() {
    return new URLSearchParams(location.search).get('chatMode') === 'temp' ||
           document.title === '临时对话';
  }

  // 元宝「新建对话」对应的无 query route: 复用 URL 上的 /chat/<id>，但
  // 刻意丢掉 ?chatMode=temp。CDP 实测 —— 浏览器级硬导航到这个 route 后
  // 重载为全新普通会话(temp=false)，且后续发送不再翻转回 temp；反之导航
  // 到首页会被 SPA 自动恢复成最近(临时)会话，回到 ?chatMode=temp 失败。
  function newChatUrl() {
    const m = location.pathname.match(/\/chat\/[^/?]+/);
    const base = m ? m[0] : '/chat/naQivTmsDa'; // SPA 默认「新建对话」route
    return 'https://yuanbao.tencent.com' + base;
  }

  // Shared response selectors — used by both the observer and getLatestResponse.
  // 2026-09 改版: 回复正文在 [class*="hyc-content-md"](完成后带 -done 后缀),
  // 用户消息在 agent-chat__bubble__content。[class*="markdown"] 现在会命中
  // 200+ 个行内代码组件(hyc-common-markdown__code__inline), 排在前面会让
  // 默认派生取到 10 字符的行内片段 —— 聚合「收集很少」的根因, 故移到最后。
  const RESPONSE_SELECTORS = [
    '[class*="hyc-content-md"]',
    '[class*="bubble__content"]',
    '[class*="chat-content"]',
    '[class*="message"] [class*="content"]',
    '[class*="answer"]',
    '[class*="response"]',
    '[class*="bubble"]',
    '.agent-chat__content',
    '[class*="markdown"]'
  ];

  window.AIPanelBase.createController({
    aiType: AI_TYPE,
    name: 'Hunyuan',
    afterInputDelay: 600, // give Tencent's React editor time to register the text

    // CHECK_INPUT 阻塞态: 有输入框但处于临时对话 —— ENSURE_TAB 重置后的轮询
    // 靠它区分「旧临时页面的 cs」与「重置后的新页面」，否则消息会发进旧页面。
    isBlockedState: function () { return isTempState(); },

    // 临时对话自愈(CDP 实测 2026-09-30): 元宝的临时态是 SPA **运行时内存**
    // 状态 —— 一旦本页曾经处于 ?chatMode=temp，之后所有发送都带
    // isTemporary:true，即使 URL 已回到无参数的 /chat/...；且与 localStorage
    // 无关(清 TEMP_CHAT_USED 无效，已用对照实验排除)。
    // 软导航(location.replace / SPA 路由 / history.replaceState) 都**保留**
    // 内存状态，重发依旧 true；只有**完整重载页面**能清掉。
    //
    // ⚠️ 关键坑: 早期实现 HARD_NAVIGATE 到首页 https://yuanbao.tencent.com/ ——
    // 而首页会**自动恢复最近会话**，那条会话正是临时对话，于是又回到
    // ?chatMode=temp「修复失败」。点侧栏「新建对话」按钮走的是
    // history.pushState('/chat/<id>') 复用同一会话 id(无 query)，SPA 把它
    // 当成全新普通会话；但合成 .click() 触发不了 React 处理器(需 trusted
    // 事件)，故内容脚本不能靠点击，只能**浏览器级硬导航到无 query 的
    // /chat/<id> 路由**(见上方 newChatUrl(); CDP Page.navigate 已实测)。
    resetToNewChat: async function () {
      const dirty = isTempState() ||
                    localStorage.getItem('TEMP_CHAT_USED') ||
                    localStorage.getItem('TEMP_CHAT_GUIDE_SHOWED');
      if (!dirty) return { reset: false };
      localStorage.removeItem('TEMP_CHAT_USED');
      localStorage.removeItem('TEMP_CHAT_GUIDE_SHOWED');
      // 浏览器级硬导航到「全新普通会话」route(无 ?chatMode=temp)。
      try {
        await chrome.runtime.sendMessage({ type: 'HARD_NAVIGATE', url: newChatUrl() });
      } catch (e) { /* background 不可达: 由 loginCheck 兜底报错 */ }
      return { reset: true };
    },

    loginCheck: async function() {
      // 兜底: 自愈已跑过仍处于临时态(重置失败/适配器未挂)时不静默发出。
      if (isTempState()) {
        throw new Error('混元仍处于临时对话(页面已自动重置过一次仍未生效)——请在页面上新建普通对话后重发');
      }
      if (window.location.pathname.includes('/login') ||
          document.querySelector('.hyc-login__dialog') ||
          document.querySelector('.hyc-login__close')) {
        throw new Error('Hunyuan not logged in. Please log in at yuanbao.tencent.com first.');
      }
    },

    inputSelectors: [
      'textarea[placeholder*="输入"]',
      'textarea[placeholder*="提问"]',
      'textarea[placeholder*="发消息"]',
      'div[contenteditable="true"][role="textbox"]',
      'div[contenteditable="true"]',
      'textarea',
      '.t-textarea__inner',
      'div[role="textbox"]'
    ],

    submitOptions: {
      selectors: [
        'button[aria-label*="提交"]',
        'a[aria-label*="提交"]',
        'button[class*="submit" i]',
        'a[aria-label*="发送"]',
        'a[aria-label*="Send"]',
        'button[aria-label*="发送"]',
        'button[aria-label*="Send"]',
        'button[type="submit"]',
        'div[role="button"][aria-label*="发送"]',
        'button[class*="send"]',
        'a[class*="send-btn"]',
        '.t-button--theme-primary'
      ],
      positivePattern: /(send|submit|发送|提交)/i,
      // ⚠️ 2026-09-30 CDP 实测抓到现行: 这里绝不能开 allowUnlabeledNearInput。
      // 元宝输入框上方一整排工具栏按钮(添加/切换模型/技能/深度研究/专业写作/
      // PPT 生成/进入临时对话…)位置分与提交按钮同高(全为 65 分并列)，一旦
      // 放行无标签候选，score>bestScore 的取首个 —— DOM 顺序里工具栏排在
      // 提交按钮前，就点了「进入临时对话」: 每发一条消息顺手把会话切进
      // 临时态(消息全部发进不留档的临时对话)。元宝发送按钮 aria 是「提交」，
      // 正向模式能直接命中，不需要无标签兑底。
      allowUnlabeledNearInput: false,
      enterFallback: true,
      maxWait: 6000,
      // Longer verify window: the send button may not change state immediately
      // after the click, which previously caused false "Submit did not start"
      // errors even though the message was actually submitted.
      verifyMaxWait: 5000,
      submittingSelectors: [
        '[aria-label*="停止"]',
        '[aria-label*="Stop"]',
        'button[aria-label*="stop"]',
        'a[aria-label*="停止"]',
        '[class*="stop-generating"]',
        '[class*="stop"]'
      ]
    },

    responseSelectors: RESPONSE_SELECTORS,

    streamingSelectors: [
      '[aria-label*="停止"]',
      '[aria-label*="Stop"]',
      'button[aria-label*="stop"]',
      'a[aria-label*="停止"]',
      '[class*="stop-generating"]'
    ],

    // CDP 实测(2026-09 改版): 自取最后一个 hyc-content-md(回复正文容器,
    // 完成时带 -done); 回退到气泡内容时跳过与输入框文本相同的用户消息。
    getLatestResponse: function () {
      var nodes = document.querySelectorAll('[class*="hyc-content-md"]');
      var node = nodes.length ? nodes[nodes.length - 1] : null;
      if (!node) {
        var editor = document.querySelector('textarea, [contenteditable="true"]');
        var editorText = editor ? ((editor.value !== undefined ? editor.value : editor.innerText) || '').trim() : '';
        var bubbles = document.querySelectorAll('[class*="bubble__content"]');
        for (var i = bubbles.length - 1; i >= 0; i--) {
          var t = (bubbles[i].innerText || '').trim();
          if (t && t !== editorText) { node = bubbles[i]; break; }
        }
      }
      if (!node) return null;
      var clone = node.cloneNode(true);
      clone.querySelectorAll('style, script').forEach(function (el) { el.remove(); });
      // 剥掉内联附件/引用卡(CDP 实测 2026-09-30): 元宝的深度研究/引用功能会把
      // 附件文件卡直接渲染进回复正文容器内部(span.hyc-common-markdown__replace-fileLink
      // > div.ybc-p--file-card > div.file-card_fileCard__xxx), 连同文件名+全文一起展开 ——
      // 不剥的话聚合会把附件内容当成混元回复的一部分。
      // ⚠️ 必须精确类名截断, 不能用 [class*="file-card"]: 宽匹配会误中
      // hyc-common-markdown(正文容器自身含 "file-card" 子串), 把整段正文删光。
      clone.querySelectorAll(
        '[class*="file-card_"], [class*="replace-fileLink"], [class*="ybc-p--file-card"], [class*="web-card_"], [class*="search-card_"]'
      ).forEach(function (el) { el.remove(); });
      var md = window.AIPanelDom && window.AIPanelDom.toMarkdown
        ? window.AIPanelDom.toMarkdown(clone)
        : (clone.innerText || '');
      md = md
        .replace(/^\s*\w*\s*(表格|复制|下载|代码预览|代码|预览)\s*$/gmi, '')
        .replace(/^\s*已深度思考[^\n]*$/gm, '')
        .replace(/```\s*\n+```/g, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
      return md || null;
    }
  });
})();
