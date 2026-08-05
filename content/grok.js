// AI Panel - Grok (xAI) Content Script
// URL: https://grok.com/
// Input: div[role="textbox"][contenteditable="true"][aria-label="Ask Grok anything"]
// Send: button[type="submit"][data-testid="chat-submit"][aria-label="提交"]

(function() {
  'use strict';

  const AI_TYPE = 'grok';
  const LOAD_FLAG = '__AIPanelContentLoaded_grok';
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
      'div[role="textbox"][contenteditable="true"][aria-label="Ask Grok anything"]',
      'div[role="textbox"][contenteditable="true"][aria-label*="Grok"]',
      'div[role="textbox"][contenteditable="true"][aria-label*="grok"]',
      'div[contenteditable="true"][aria-label*="Ask"]',
      'div[role="textbox"][contenteditable="true"]',
      'div[contenteditable="true"]',
      'textarea[aria-label*="Grok"]',
      'textarea[aria-label*="grok"]',
      'textarea'
    ];

    const inputEl = window.AIPanelDom?.findInputField(inputSelectors, { preferBottom: true });
    if (!inputEl) throw new Error('Could not find Grok input field');

    await window.AIPanelDom.setEditorText(inputEl, text, { afterInputDelay: 500 });

    const submitResult = await window.AIPanelDom.submitMessage(inputEl, {
      selectors: [
        'button[type="submit"][data-testid="chat-submit"]',
        'button[data-testid="chat-submit"]',
        'button[type="submit"][aria-label="提交"]',
        'button[type="submit"]',
        'button[aria-label*="Submit"]',
        'button[aria-label*="提交"]'
      ],
      positivePattern: /(submit|send|提交|发送)/i,
      allowUnlabeledNearInput: true,
      enterFallback: true,
      maxWait: 6000,
      verifyMaxWait: 3000,
      submittingSelectors: [
        '[aria-label*="Stop"]',
        '[aria-label*="停止"]',
        'button[aria-label*="stop"]',
        '[class*="stop-generating"]'
      ]
    });

    console.log('[AI Panel] Grok message sent via', submitResult.method);
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

  let isCapturing = false;

  function checkForResponse(node) {
    if (isCapturing) return;
    const responseSelectors = ['.message-bubble', '[data-testid*="message"]', '.prose-chat', '[class*="markdown"]'];
    for (const selector of responseSelectors) {
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

        const isStreaming = document.querySelector('[aria-label*="Stop"]') ||
                           document.querySelector('[aria-label*="停止"]') ||
                           document.querySelector('button[aria-label*="stop"]');
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
    const selectors = ['.message-bubble', '.prose-chat', '[data-testid*="message"]', '[class*="markdown"]'];
    let blocks = [];
    for (const selector of selectors) {
      blocks = document.querySelectorAll(selector);
      if (blocks.length > 0) break;
    }
    if (blocks.length === 0) return null;
    return blocks[blocks.length - 1].innerText.trim();
  }

  function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
  console.log('[AI Panel] Grok content script loaded');
})();
