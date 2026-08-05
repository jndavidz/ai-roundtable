// AI Panel - GLM (Zhipu) Content Script
// Supports chatglm.cn and z.ai — uses textarea + dom-utils helpers
// Note: GLM-5.2 has thinking mode; thinking blocks are filtered from captured response

(function() {
  'use strict';

  const AI_TYPE = 'glm';
  const LOAD_FLAG = '__AIPanelContentLoaded_glm';
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

  // —— Inject message into GLM textarea and submit ——
  // GLM (chatglm.cn / z.ai) DOM structure (verified 2026-07-30):
  //   #search-input-box > .input-wrap > .input-box-inner > textarea.scroll-display-none
  //   Send button: .input-box-container > .options-container > div.enter.is-main-chat
  //   Placeholder is a sibling .custom-placeholder div (not on textarea itself)
  async function injectMessage(text) {
    const inputSelectors = [
      '#search-input-box textarea',
      '.input-box-inner textarea',
      '.input-wrap textarea',
      '.input-box textarea',
      'textarea.scroll-display-none',
      'textarea[placeholder*="输入"]',
      'textarea[placeholder*="提问"]',
      'div[contenteditable="true"][role="textbox"]',
      'div[contenteditable="true"]'
    ];

    const inputEl = window.AIPanelDom?.findInputField(inputSelectors, { preferBottom: true });

    if (!inputEl) {
      throw new Error('Could not find GLM input field');
    }

    await window.AIPanelDom.setEditorText(inputEl, text, { afterInputDelay: 500 });

    const submitResult = await window.AIPanelDom.submitMessage(inputEl, {
      selectors: [
        'div.enter',
        'div.enter.is-main-chat',
        '#search-input-box .enter',
        '.input-box-container .enter',
        '.enter-icon-container',
        'button[aria-label*="发送"]',
        'button[aria-label*="Send"]',
        'div[role="button"][aria-label*="发送"]',
        'button[type="submit"]',
        'div[role="button"]'
      ],
      positivePattern: /(send|submit|发送|提交|enter)/i,
      allowUnlabeledNearInput: true,
      enterFallback: true,
      maxWait: 6000,
      verifyMaxWait: 3000,
      // GLM streaming indicators (verified against chatglm.cn 2026-07-30):
      //   div.enter gains "searching" class while generating (most reliable)
      //   .enter-icon-container loses "empty" class while generating
      submittingSelectors: [
        'div.enter.searching',
        '.enter-icon-container:not(.empty)',
        'div[aria-label*="停止"]',
        'div[role="button"][aria-label*="Stop"]',
        '[class*="stop-generating"]'
      ]
    });

    console.log('[AI Panel] GLM message sent via', submitResult.method, 'starting response capture...');
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

    // GLM response area selectors (verified against chatglm.cn DOM)
    const responseSelectors = [
      '.markdown-body',
      '[class*="message"] [class*="content"]',
      '[class*="answer"]',
      '[class*="response"]',
      '[class*="bubble"]',
      '.chat-top-section',
      '.glms-operation-content',
      '[class*="chat-content"]'
    ];

    for (const selector of responseSelectors) {
      if (node.matches?.(selector) || node.querySelector?.(selector)) {
        console.log('[AI Panel] GLM detected new response...');
        waitForStreamingComplete();
        break;
      }
    }
  }

  async function waitForStreamingComplete(preSendContent) {
    if (isCapturing) {
      console.log('[AI Panel] GLM already capturing, skipping...');
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

        // GLM streaming detection (verified against chatglm.cn 2026-07-30):
        //   div.enter.searching — send button gains "searching" class while generating
        //   This is the ONLY reliable indicator; [class*="loading"] is too broad
        //   (matches lazy-load images, skeleton screens, etc.) and causes false positives
        const isStreaming = document.querySelector('div.enter.searching');

        const currentContent = getLatestResponse() || '';

        // Detect NEW content (different from what was on screen before sending)
        if (!newContentDetected && currentContent && currentContent !== preSendContent) {
          newContentDetected = true;
          console.log('[AI Panel] GLM NEW content detected, length:', currentContent.length);
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
              console.log('[AI Panel] GLM response captured, length:', currentContent.length);
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
    // Try multiple selectors for GLM's response containers
    // GLM uses various containers for markdown-rendered responses
    const selectors = [
      '.markdown-body',
      '[class*="chat-content"]',
      '[class*="answer"] [class*="content"]',
      '[class*="response"] [class*="content"]',
      '[class*="bubble"] [class*="content"]',
      '[class*="message"] [class*="content"]',
      '.detail-container [class*="content"]'
    ];

    let blocks = [];
    for (const selector of selectors) {
      blocks = document.querySelectorAll(selector);
      if (blocks.length > 0) break;
    }

    if (blocks.length === 0) return null;

    const lastBlock = blocks[blocks.length - 1];

    // Filter out thinking blocks (GLM-5.2 thinking mode)
    // Thinking blocks are typically in collapsible containers with specific classes
    const responseText = filterThinkingContent(lastBlock);
    return responseText.trim();
  }

  // Filter out GLM thinking/reasoning blocks from the response
  function filterThinkingContent(element) {
    // Clone to avoid modifying the DOM
    const clone = element.cloneNode(true);

    // Remove thinking blocks — they are usually in containers with:
    // - class containing "think" or "thought" or "reasoning"
    // - containers with overflow-hidden and max-height constraints (collapsed thinking)
    const thinkingSelectors = [
      '[class*="think"]',
      '[class*="thought"]',
      '[class*="reasoning"]',
      '[class*="overflow-hidden"][class*="max-h"]',
      '[data-type="thinking"]',
      '[data-type="reasoning"]'
    ];

    for (const selector of thinkingSelectors) {
      clone.querySelectorAll(selector).forEach(el => el.remove());
    }

    return clone.innerText;
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  console.log('[AI Panel] GLM content script loaded');
})();
