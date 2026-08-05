// AI Panel - Doubao (ByteDance) Content Script
// URL: https://www.doubao.com/
// Input: textarea.semi-input-textarea (placeholder: "发消息...")
// Send: button[class*="rounded-dbx"] (circular button near input, no aria-label)
// Response: [data-testid*="message"] or [class*="markdown"] containers

(function() {
  'use strict';

  const AI_TYPE = 'doubao';
  const LOAD_FLAG = '__AIPanelContentLoaded_doubao';
  const LOAD_VERSION = chrome.runtime?.getManifest?.().version || 'unknown';
  if (window[LOAD_FLAG] === LOAD_VERSION) return;
  window[LOAD_FLAG] = LOAD_VERSION;

  // Shared response selectors — used by both checkForResponse and getLatestResponse
  const RESPONSE_SELECTORS = [
    '[data-testid*="message"]',
    '[data-testid*="receive"]',
    '[data-testid*="answer"]',
    '[class*="markdown"]',
    '[class*="message"] [class*="content"]',
    '[class*="answer"]',
    '[class*="response"]',
    '[class*="bubble"]'
  ];

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
      'textarea.semi-input-textarea',
      'textarea.semi-input-textarea-autosize',
      'textarea[placeholder*="发消息"]',
      'textarea[placeholder*="输入"]',
      'textarea[placeholder*="提问"]',
      'div[contenteditable="true"][role="textbox"]',
      'div[contenteditable="true"]',
      'textarea'
    ];

    const inputEl = window.AIPanelDom?.findInputField(inputSelectors, { preferBottom: true });
    if (!inputEl) throw new Error('Could not find Doubao input field');

    await window.AIPanelDom.setEditorText(inputEl, text, { afterInputDelay: 500 });

    const submitResult = await window.AIPanelDom.submitMessage(inputEl, {
      selectors: [
        'button[class*="rounded-dbx"]',
        'button[class*="size-36"]',
        'button[class*="!rounded-full"]',
        'button[aria-label*="发送"]',
        'button[aria-label*="Send"]',
        'button[type="submit"]',
        'div[role="button"][aria-label*="发送"]'
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
        '[class*="stop-generating"]',
        '[class*="stop"]'
      ]
    });

    console.log('[AI Panel] Doubao message sent via', submitResult.method);
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
      // Observe the entire document body for reliable response detection
      observer.observe(document.body, { childList: true, subtree: true });
    };
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', startObserving);
    } else { startObserving(); }
  }

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
  console.log('[AI Panel] Doubao content script loaded');
})();
