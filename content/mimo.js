// AI Panel - MiMo (Xiaomi) Content Script
// URL: https://aistudio.xiaomimimo.com/
// Input: div[contenteditable="true"] (rich text editor with Tailwind classes)
// Send: button.rounded-full[class*="bg-black"] (circular send button)

(function() {
  'use strict';

  const AI_TYPE = 'mimo';
  const LOAD_FLAG = '__AIPanelContentLoaded_mimo';
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
    const inputSelectors = [
      'div[contenteditable="true"][class*="resize-none"]',
      'div[contenteditable="true"][class*="overflow-y-auto"]',
      'div[contenteditable="true"][class*="placeholder-gray-400"]',
      'div[contenteditable="true"]',
      'textarea[placeholder*="聊天"]',
      'textarea[placeholder*="输入"]',
      'textarea'
    ];

    const inputEl = window.AIPanelDom?.findInputField(inputSelectors, { preferBottom: true });
    if (!inputEl) throw new Error('Could not find MiMo input field');

    await window.AIPanelDom.setEditorText(inputEl, text, { afterInputDelay: 500 });

    const submitResult = await window.AIPanelDom.submitMessage(inputEl, {
      selectors: [
        'button.rounded-full[class*="bg-black"]',
        'button.rounded-full[class*="bg-white"]',
        'button[class*="rounded-full"][class*="bg-black/90"]',
        'button[class*="rounded-full"]',
        'button[type="submit"]',
        'button[aria-label*="发送"]',
        'button[aria-label*="Send"]'
      ],
      positivePattern: /(send|submit|发送|提交)/i,
      allowUnlabeledNearInput: true,
      enterFallback: true,
      maxWait: 6000,
      verifyMaxWait: 3000,
      submittingSelectors: [
        'button[aria-label*="停止"]',
        'button[aria-label*="Stop"]',
        '[class*="stop-generating"]',
        '[class*="stop"]'
      ]
    });

    console.log('[AI Panel] MiMo message sent via', submitResult.method);
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

  const RESPONSE_SELECTORS = ['[class*="markdown"]', '[class*="message"] [class*="content"]', '[class*="answer"]', '[class*="response"]', '[class*="bubble"]'];
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

        const isStreaming = document.querySelector('button[aria-label*="停止"]') ||
                           document.querySelector('button[aria-label*="Stop"]') ||
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
  console.log('[AI Panel] MiMo content script loaded');
})();
