// AI Panel - DeepSeek Content Script
// Supports chat.deepseek.com — uses standard textarea + dom-utils helpers

(function() {
  'use strict';

  const AI_TYPE = 'deepseek';
  const LOAD_FLAG = '__AIPanelContentLoaded_deepseek';
  const LOAD_VERSION = chrome.runtime?.getManifest?.().version || 'unknown';
  if (window[LOAD_FLAG] === LOAD_VERSION) return;
  window[LOAD_FLAG] = LOAD_VERSION;

  function isContextValid() {
    return chrome.runtime && chrome.runtime.id;
  }

  function safeSendMessage(message, callback) {
    if (!isContextValid()) {
      console.log('[AI Panel] Extension context invalidated, skipping message');
      return;
    }
    try {
      chrome.runtime.sendMessage(message, callback);
    } catch (e) {
      console.log('[AI Panel] Failed to send message:', e.message);
    }
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
      const response = getLatestResponse();
      sendResponse({ content: response });
      return true;
    }
  });

  setupResponseObserver();

  // —— Inject message into DeepSeek textarea and submit ——
  async function injectMessage(text) {
    // DeepSeek uses a standard textarea. Try multiple selectors for resilience.
    const inputSelectors = [
      'textarea#chat-input',
      'textarea[placeholder*="给"]',
      'textarea[placeholder*="消息"]',
      'textarea[placeholder*="输入"]',
      'textarea[placeholder*="问"]',
      'div[contenteditable="true"][role="textbox"]',
      'div[contenteditable="true"]'
    ];

    const inputEl = window.AIPanelDom?.findInputField(inputSelectors, { preferBottom: true });

    if (!inputEl) {
      throw new Error('Could not find DeepSeek input field');
    }

    await window.AIPanelDom.setEditorText(inputEl, text, { afterInputDelay: 500 });

    const submitResult = await window.AIPanelDom.submitMessage(inputEl, {
      selectors: [
        'div[role="button"][aria-label*="发送"]',
        'button[aria-label*="发送"]',
        'button[aria-label*="Send"]',
        'div[role="button"] .icon-send',
        'div[role="button"] svg[class*="send"]',
        'div.send-button',
        'button[type="submit"]',
        'div[role="button"]'
      ],
      positivePattern: /(send|submit|发送|提交)/i,
      allowUnlabeledNearInput: true,
      enterFallback: true,
      maxWait: 6000,
      verifyMaxWait: 3000,
      submittingSelectors: [
        'div[aria-label*="停止"]',
        'div[role="button"][aria-label*="Stop"]',
        'div[role="button"][aria-label*="stop"]',
        '[class*="stop"]',
        '[class*="loading"]'
      ]
    });

    console.log('[AI Panel] DeepSeek message sent via', submitResult.method, 'starting response capture...');
    // Record content BEFORE the new response appears, so we only capture NEW content
    const preSendContent = getLatestResponse() || '';
    waitForStreamingComplete(preSendContent);
    return true;
  }

  function setupResponseObserver() {
    const observer = new MutationObserver((mutations) => {
      if (!isContextValid()) {
        observer.disconnect();
        return;
      }
      for (const mutation of mutations) {
        if (mutation.type === 'childList') {
          for (const node of mutation.addedNodes) {
            if (node.nodeType === Node.ELEMENT_NODE) {
              checkForResponse(node);
            }
          }
        }
      }
    });

    const startObserving = () => {
      if (!isContextValid()) return;
      const mainContent = document.querySelector('main') || document.body;
      observer.observe(mainContent, {
        childList: true,
        subtree: true
      });
    };

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', startObserving);
    } else {
      startObserving();
    }
  }

  let lastCapturedContent = '';
  let isCapturing = false;

  function checkForResponse(node) {
    if (isCapturing) return;

    const responseSelectors = [
      '.ds-markdown',
      '.ds-markdown--block',
      '.markdown-body',
      '[class*="message"] [class*="content"]',
      '[class*="answer"]',
      '[class*="response"]'
    ];

    for (const selector of responseSelectors) {
      if (node.matches?.(selector) || node.querySelector?.(selector)) {
        console.log('[AI Panel] DeepSeek detected new response...');
        waitForStreamingComplete();
        break;
      }
    }
  }

  async function waitForStreamingComplete(preSendContent) {
    if (isCapturing) {
      console.log('[AI Panel] DeepSeek already capturing, skipping...');
      return;
    }
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
        if (!isContextValid()) {
          console.log('[AI Panel] Context invalidated, stopping capture');
          return;
        }

        await sleep(checkInterval);

        // DeepSeek streaming detection: look for stop button or loading indicators
        const isStreaming = document.querySelector('div[aria-label*="停止"]') ||
                           document.querySelector('div[role="button"][aria-label*="Stop"]') ||
                           document.querySelector('div[role="button"][aria-label*="stop"]') ||
                           document.querySelector('.stop-button') ||
                           document.querySelector('[class*="stop-generating"]');

        const currentContent = getLatestResponse() || '';

        // Detect NEW content (different from what was on screen before sending)
        if (!newContentDetected && currentContent && currentContent !== preSendContent) {
          newContentDetected = true;
          console.log('[AI Panel] DeepSeek NEW content detected, length:', currentContent.length);
        }

        // Only check stability after new content has been detected
        if (newContentDetected) {
          if (!isStreaming && currentContent === previousContent && currentContent.length > 0) {
            stableCount++;
            if (stableCount >= stableThreshold) {
              lastCapturedContent = currentContent;
              safeSendMessage({
                type: 'RESPONSE_CAPTURED',
                aiType: AI_TYPE,
                content: currentContent
              });
              console.log('[AI Panel] DeepSeek response captured, length:', currentContent.length);
              return;
            }
          } else {
            stableCount = 0;
          }
        }

        previousContent = currentContent;
      }
    } finally {
      isCapturing = false;
    }
  }

  function getLatestResponse() {
    // Try multiple selectors for DeepSeek's response containers
    const selectors = [
      '.ds-markdown--block',
      '.ds-markdown',
      '.markdown-body',
      '[class*="message"] [class*="content"]',
      '[class*="answer"] [class*="content"]',
      '[class*="response"] [class*="content"]'
    ];

    let blocks = [];
    for (const selector of selectors) {
      blocks = document.querySelectorAll(selector);
      if (blocks.length > 0) break;
    }

    if (blocks.length === 0) return null;

    const lastBlock = blocks[blocks.length - 1];
    return lastBlock.innerText.trim();
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  console.log('[AI Panel] DeepSeek content script loaded');
})();
