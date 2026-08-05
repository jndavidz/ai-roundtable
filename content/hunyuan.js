// AI Panel - Hunyuan (Tencent Yuanbao) Content Script
// URL: https://yuanbao.tencent.com/
// Login required (WeChat / QQ / phone number)
// Input: textarea or div[contenteditable] (Tencent Design components)
// Send: button or a[aria-label*="发送"] (TDesign button system)

(function() {
  'use strict';

  const AI_TYPE = 'hunyuan';
  const LOAD_FLAG = '__AIPanelContentLoaded_hunyuan';
  const LOAD_VERSION = chrome.runtime?.getManifest?.().version || 'unknown';
  if (window[LOAD_FLAG] === LOAD_VERSION) return;
  window[LOAD_FLAG] = LOAD_VERSION;

  function isContextValid() { return chrome.runtime && chrome.runtime.id; }

  function safeSendMessage(message, callback) {
    if (!isContextValid()) return;
    try { chrome.runtime.sendMessage(message, callback); } catch (e) {}
  }

  safeSendMessage({ type: 'CONTENT_SCRIPT_READY', aiType: AI_TYPE });

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'INJECT_MESSAGE') {
      injectMessage(message.message)
        .then(() => sendResponse({ success: true }))
        .catch(err => sendResponse({ success: false, error: err.message }));
      return true;
    }
    if (message.type === 'GET_LATEST_RESPONSE') {
      sendResponse({ content: getLatestResponse() });
      return true;
    }
  });

  setupResponseObserver();

  async function injectMessage(text) {
    // Check if on login page
    if (window.location.pathname.includes('/login') ||
        document.querySelector('.hyc-login__dialog') ||
        document.querySelector('.hyc-login__close')) {
      throw new Error('Hunyuan not logged in. Please log in at yuanbao.tencent.com first.');
    }

    const inputSelectors = [
      'textarea[placeholder*="输入"]',
      'textarea[placeholder*="提问"]',
      'textarea[placeholder*="发消息"]',
      'div[contenteditable="true"][role="textbox"]',
      'div[contenteditable="true"]',
      'textarea',
      '.t-textarea__inner',
      'div[role="textbox"]'
    ];

    const inputEl = window.AIPanelDom?.findInputField(inputSelectors, { preferBottom: true });
    if (!inputEl) throw new Error('Could not find Hunyuan input field');

    await window.AIPanelDom.setEditorText(inputEl, text, { afterInputDelay: 500 });

    const submitResult = await window.AIPanelDom.submitMessage(inputEl, {
      selectors: [
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
      allowUnlabeledNearInput: true,
      enterFallback: true,
      maxWait: 6000,
      verifyMaxWait: 3000,
      submittingSelectors: [
        '[aria-label*="停止"]',
        '[aria-label*="Stop"]',
        'button[aria-label*="stop"]',
        'a[aria-label*="停止"]',
        '[class*="stop-generating"]',
        '[class*="stop"]'
      ]
    });

    console.log('[AI Panel] Hunyuan message sent via', submitResult.method);
    const preSendContent = getLatestResponse() || '';
    waitForStreamingComplete(preSendContent);
    return true;
  }

  function setupResponseObserver() {
    const observer = new MutationObserver((mutations) => {
      if (!isContextValid()) { observer.disconnect(); return; }
      for (const mutation of mutations) {
        if (mutation.type === 'childList') {
          for (const node of mutation.addedNodes) {
            if (node.nodeType === Node.ELEMENT_NODE) checkForResponse(node);
          }
        }
      }
    });
    const startObserving = () => {
      if (!isContextValid()) return;
      observer.observe(document.querySelector('main') || document.body, { childList: true, subtree: true });
    };
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', startObserving);
    } else { startObserving(); }
  }

  // Shared response selectors — used by both checkForResponse and getLatestResponse
  const RESPONSE_SELECTORS = [
    '[class*="markdown"]',
    '[class*="chat-content"]',
    '[class*="message"] [class*="content"]',
    '[class*="answer"]',
    '[class*="response"]',
    '[class*="bubble"]',
    '.agent-chat__content'
  ];

  let isCapturing = false;

  function checkForResponse(node) {
    if (isCapturing) return;
    for (const selector of RESPONSE_SELECTORS) {
      if (node.matches?.(selector) || node.querySelector?.(selector)) {
        waitForStreamingComplete();
        break;
      }
    }
  }

  async function waitForStreamingComplete(preSendContent) {
    if (isCapturing) return;
    isCapturing = true;

    let previousContent = '';
    let stableCount = 0;
    const maxWait = 600000;
    const checkInterval = 500;
    const stableThreshold = 4;
    const startTime = Date.now();
    let newContentDetected = false;

    try {
      while (Date.now() - startTime < maxWait) {
        if (!isContextValid()) return;
        await sleep(checkInterval);

        const isStreaming = document.querySelector('[aria-label*="停止"]') ||
                           document.querySelector('[aria-label*="Stop"]') ||
                           document.querySelector('button[aria-label*="stop"]') ||
                           document.querySelector('a[aria-label*="停止"]') ||
                           document.querySelector('[class*="stop-generating"]');
        const currentContent = getLatestResponse() || '';

        if (!newContentDetected && currentContent && currentContent !== preSendContent) {
          newContentDetected = true;
        }

        if (newContentDetected) {
          if (!isStreaming && currentContent === previousContent && currentContent.length > 0) {
            stableCount++;
            if (stableCount >= stableThreshold) {
              if (currentContent === preSendContent) { stableCount = 0; previousContent = currentContent; continue; }
              safeSendMessage({ type: 'RESPONSE_CAPTURED', aiType: AI_TYPE, content: currentContent });
              return;
            }
          } else { stableCount = 0; }
        }
        previousContent = currentContent;
      }
    } finally { isCapturing = false; }
  }

  function getLatestResponse() {
    for (const selector of RESPONSE_SELECTORS) {
      const blocks = document.querySelectorAll(selector);
      if (blocks.length > 0) {
        return blocks[blocks.length - 1].innerText.trim();
      }
    }
    return null;
  }

  function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
  console.log('[AI Panel] Hunyuan content script loaded');
})();
