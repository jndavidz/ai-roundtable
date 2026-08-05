// AI Panel - ChatGPT Content Script

(function() {
  'use strict';

  const AI_TYPE = 'chatgpt';
  const LOAD_FLAG = '__AIPanelContentLoaded_chatgpt';
  const LOAD_VERSION = chrome.runtime?.getManifest?.().version || 'unknown';
  if (window[LOAD_FLAG] === LOAD_VERSION) return;
  window[LOAD_FLAG] = LOAD_VERSION;

  // Check if extension context is still valid
  function isContextValid() {
    return chrome.runtime && chrome.runtime.id;
  }

  // Safe message sender that checks context first
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

  // Notify background that content script is ready
  safeSendMessage({ type: 'CONTENT_SCRIPT_READY', aiType: AI_TYPE });

  // Listen for messages from background script
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'INJECT_MESSAGE') {
      injectMessage(message.message)
        .then(() => sendResponse({ success: true }))
        .catch(err => sendResponse({ success: false, error: err.message }));
      return true;
    }

    if (message.type === 'INJECT_FILES') {
      injectFiles(message.files)
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

  // Setup response observer for cross-reference feature
  setupResponseObserver();

  async function injectMessage(text) {
    // Guard: if ChatGPT redirected to login/auth page, abort immediately
    // The login page has a textarea (email input) that would be falsely matched
    if (location.pathname.includes('/auth/login') || location.pathname.includes('/auth/')) {
      throw new Error('ChatGPT 未登录，请在 ChatGPT 标签页中登录后重试');
    }

    // ChatGPT uses a contenteditable div (previously textarea, changed in 2025+)
    const inputSelectors = [
      '#prompt-textarea',
      'div[contenteditable="true"]#prompt-textarea',
      'div[contenteditable="true"][data-placeholder]',
      'textarea[data-id="root"]',
      'textarea[placeholder*="Message"]',
      'div[contenteditable="true"][role="textbox"]'
      // NOTE: bare 'textarea' removed — it falsely matches the login page email input
    ];

    let inputEl = null;
    for (const selector of inputSelectors) {
      inputEl = document.querySelector(selector);
      if (inputEl) break;
    }

    if (!inputEl) {
      throw new Error('Could not find input field (ChatGPT 可能未登录)');
    }

    // Focus the input
    inputEl.focus();

    // Handle different input types
    if (inputEl.tagName === 'TEXTAREA') {
      inputEl.value = text;
      inputEl.dispatchEvent(new Event('input', { bubbles: true }));
    } else {
      // Contenteditable div (ChatGPT switched from textarea to contenteditable in 2025)
      // Need to set innerHTML with <p> tags for proper React state update
      inputEl.innerHTML = `<p>${escapeHtml(text)}</p>`;
      inputEl.dispatchEvent(new Event('input', { bubbles: true }));
    }

    // Small delay to let React process
    await sleep(100);

    // Find and click the send button
    const sendButton = findSendButton();
    if (!sendButton) {
      throw new Error('Could not find send button');
    }

    // Wait for button to be enabled
    await waitForButtonEnabled(sendButton);

    sendButton.click();

    // Start capturing response after sending
    // Record content BEFORE the new response appears, so we only capture NEW content
    const preSendContent = getLatestResponse() || '';
    console.log('[AI Panel] ChatGPT message sent, starting response capture... preSendLen:', preSendContent.length);
    waitForStreamingComplete(preSendContent);

    return true;
  }

  function findSendButton() {
    // ChatGPT's send button
    const selectors = [
      'button[data-testid="send-button"]',
      'button[aria-label="Send prompt"]',
      'button[aria-label="Send message"]',
      'form button[type="submit"]',
      'button svg path[d*="M15.192"]' // Arrow icon path
    ];

    for (const selector of selectors) {
      const el = document.querySelector(selector);
      if (el) {
        return el.closest('button') || el;
      }
    }

    // Fallback: find button near the input
    const form = document.querySelector('form');
    if (form) {
      const buttons = form.querySelectorAll('button');
      for (const btn of buttons) {
        if (btn.querySelector('svg') && isVisible(btn)) {
          return btn;
        }
      }
    }

    return null;
  }

  async function waitForButtonEnabled(button, maxWait = 2000) {
    const start = Date.now();
    while (button.disabled && Date.now() - start < maxWait) {
      await sleep(50);
    }
  }

  function setupResponseObserver() {
    const observer = new MutationObserver((mutations) => {
      // Check context validity in observer callback
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
      '[data-message-author-role="assistant"]',
      '.agent-turn',
      '[class*="assistant"]'
    ];

    for (const selector of responseSelectors) {
      if (node.matches?.(selector) || node.querySelector?.(selector)) {
        console.log('[AI Panel] ChatGPT detected new response...');
        waitForStreamingComplete();
        break;
      }
    }
  }

  // Count assistant message containers — reliable signal for new message detection
  function getMessageContainerCount() {
    const containerSelectors = [
      '[data-message-author-role="assistant"]',
      '[data-testid*="conversation-turn"]',
      '.agent-turn'
    ];
    for (const selector of containerSelectors) {
      const count = document.querySelectorAll(selector).length;
      if (count > 0) return count;
    }
    return 0;
  }

  // Detect ChatGPT streaming indicators (Stop button appears while generating)
  function isStreamingActive() {
    return !!(
      document.querySelector('button[aria-label*="Stop"]') ||
      document.querySelector('button[data-testid="stop-button"]') ||
      document.querySelector('button[aria-label*="停止"]') ||
      document.querySelector('button[aria-label*="stop"]') ||
      document.querySelector('button[data-testid*="stop"]') ||
      // Additional: ChatGPT sometimes uses a different stop button layout
      document.querySelector('button[aria-label*="Stream"]')
    );
  }

  async function waitForStreamingComplete(preSendContent) {
    console.log('[AI Panel] ChatGPT waitForStreamingComplete called, isCapturing:', isCapturing);

    if (isCapturing) {
      console.log('[AI Panel] ChatGPT already capturing, skipping...');
      return;
    }
    isCapturing = true;
    console.log('[AI Panel] ChatGPT starting capture loop...');

    let previousContent = '';
    let stableCount = 0;
    const maxWait = 600000;       // 10 minutes absolute cap
    const checkInterval = 500;
    const stableThreshold = 4;    // 2 seconds of stable content
    const fallbackTimeout = 45000; // 45s: if no new content detected, try fallback capture

    const startTime = Date.now();
    let newContentDetected = false;
    let streamingEverDetected = false;
    let lastStreamingTime = 0;
    const preSendContainerCount = getMessageContainerCount();
    const preSendUrl = location.pathname;

    console.log('[AI Panel] ChatGPT pre-send state — containers:', preSendContainerCount,
                ', contentLen:', (preSendContent || '').length);

    try {
      while (Date.now() - startTime < maxWait) {
        if (!isContextValid()) {
          console.log('[AI Panel] Context invalidated, stopping capture');
          return;
        }

        // Abort if page navigated to login/auth (session expired mid-debate)
        if (location.pathname.includes('/auth/')) {
          console.log('[AI Panel] ChatGPT navigated to auth page, aborting capture');
          safeSendMessage({
            type: 'RESPONSE_CAPTURED',
            aiType: AI_TYPE,
            content: null,
            error: 'ChatGPT 会话已过期，请重新登录'
          });
          return;
        }

        await sleep(checkInterval);

        const currentContent = getLatestResponse() || '';
        const currentContainerCount = getMessageContainerCount();
        const isStreaming = isStreamingActive();

        if (isStreaming) {
          streamingEverDetected = true;
          lastStreamingTime = Date.now();
        }

        // Multi-signal NEW content detection:
        //   Signal 1: assistant container count increased (most reliable)
        //   Signal 2: content text changed from pre-send state
        //   Signal 3: streaming indicator active (Stop button visible)
        if (!newContentDetected) {
          const containerIncreased = currentContainerCount > preSendContainerCount;
          const contentChanged = currentContent && currentContent !== preSendContent;
          const streamingActive = isStreaming;

          if (containerIncreased || contentChanged || streamingActive) {
            newContentDetected = true;
            console.log('[AI Panel] ChatGPT NEW content detected —',
                        'containers:', preSendContainerCount, '→', currentContainerCount,
                        ', contentChanged:', !!contentChanged,
                        ', streaming:', streamingActive,
                        ', contentLen:', currentContent.length);
          }
        }

        // Fallback: after 45s, if no new content detected but page has content
        // different from pre-send, capture it anyway (detection signals may have missed)
        if (!newContentDetected && Date.now() - startTime > fallbackTimeout) {
          if (currentContent && currentContent !== preSendContent) {
            console.log('[AI Panel] ChatGPT fallback capture — content changed but no signal fired');
            newContentDetected = true;
          } else if (currentContainerCount > preSendContainerCount) {
            console.log('[AI Panel] ChatGPT fallback capture — container count increased');
            newContentDetected = true;
          }
        }

        // Stability check: content hasn't changed AND streaming has stopped
        if (newContentDetected) {
          const streamingStopped = !isStreaming && (Date.now() - lastStreamingTime > 2000);
          if (streamingStopped && currentContent === previousContent && currentContent.length > 0) {
            stableCount++;
            if (stableCount >= stableThreshold) {
              // Final guard: don't capture if content is identical to pre-send
              if (currentContent === preSendContent) {
                console.log('[AI Panel] ChatGPT content same as pre-send, continuing to wait...');
                stableCount = 0;
                previousContent = currentContent;
                continue;
              }
              lastCapturedContent = currentContent;
              console.log('[AI Panel] ChatGPT capturing response, length:', currentContent.length);
              safeSendMessage({
                type: 'RESPONSE_CAPTURED',
                aiType: AI_TYPE,
                content: currentContent
              });
              console.log('[AI Panel] ChatGPT response captured and sent!');
              return;
            }
          } else {
            stableCount = 0;
          }

          // Stale streaming detection: if streaming was active for >120s but
          // content has been stable for 15s, capture anyway (streaming indicator may be stuck)
          if (streamingEverDetected && Date.now() - lastStreamingTime > 15000 &&
              currentContent === previousContent && currentContent.length > 0 &&
              currentContent !== preSendContent) {
            console.log('[AI Panel] ChatGPT stale streaming detected, force-capturing');
            lastCapturedContent = currentContent;
            safeSendMessage({
              type: 'RESPONSE_CAPTURED',
              aiType: AI_TYPE,
              content: currentContent
            });
            console.log('[AI Panel] ChatGPT response force-captured, length:', currentContent.length);
            return;
          }
        }

        previousContent = currentContent;
      }
      console.log('[AI Panel] ChatGPT capture timeout after', maxWait/1000, 'seconds');
    } finally {
      isCapturing = false;
      console.log('[AI Panel] ChatGPT capture loop ended');
    }
  }

  function getLatestResponse() {
    // Strategy: find the assistant message container first, then extract ALL text content
    // This handles ChatGPT's evolving UI where content may be in .markdown, canvas boxes,
    // code blocks, or other nested containers

    // Step 1: Find all assistant message containers
    const containerSelectors = [
      '[data-message-author-role="assistant"]',
      '[data-testid*="conversation-turn"]:has([data-message-author-role="assistant"])',
      '.agent-turn'
    ];

    let containers = [];
    for (const selector of containerSelectors) {
      containers = document.querySelectorAll(selector);
      if (containers.length > 0) break;
    }

    if (containers.length === 0) return null;

    const lastContainer = containers[containers.length - 1];

    // Step 2: Collect text from all content areas within the container
    // Try to get structured content first (markdown + canvas/text boxes)
    const contentParts = [];

    // Markdown sections
    const markdownEls = lastContainer.querySelectorAll('.markdown, [class*="markdown"]');
    // Canvas/text box sections (ChatGPT wraps some content in bordered containers)
    const canvasEls = lastContainer.querySelectorAll('[class*="canvas"], [class*="text-block"], [class*="code-block"], pre code');

    if (markdownEls.length > 0 || canvasEls.length > 0) {
      // Collect from markdown blocks
      markdownEls.forEach(el => {
        const text = el.innerText.trim();
        if (text) contentParts.push(text);
      });
      // Collect from canvas/text-box blocks not already inside markdown
      canvasEls.forEach(el => {
        // Skip if this element is inside a markdown container we already captured
        if (el.closest('.markdown, [class*="markdown"]')) return;
        const text = el.innerText.trim();
        if (text) contentParts.push(text);
      });
    }

    // Step 3: If structured selectors found content, use it; otherwise fall back to full container text
    if (contentParts.length > 0) {
      return contentParts.join('\n\n').trim();
    }

    // Fallback: get the full innerText of the assistant container
    // This catches any new UI elements ChatGPT might add
    return lastContainer.innerText.trim();
  }

  // Utility functions
  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function isVisible(el) {
    const style = window.getComputedStyle(el);
    return style.display !== 'none' &&
           style.visibility !== 'hidden' &&
           style.opacity !== '0';
  }

  // File injection using DataTransfer API
  async function injectFiles(filesData) {
    console.log('[AI Panel] ChatGPT injecting files:', filesData.length);

    // Convert base64 to File objects
    const files = filesData.map(fileData => {
      const byteCharacters = atob(fileData.base64);
      const byteNumbers = new Array(byteCharacters.length);
      for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
      }
      const byteArray = new Uint8Array(byteNumbers);
      const blob = new Blob([byteArray], { type: fileData.type });
      return new File([blob], fileData.name, { type: fileData.type });
    });

    // Find the file input
    const fileInput = document.querySelector('input[type="file"]');

    if (fileInput) {
      const dataTransfer = new DataTransfer();
      files.forEach(file => dataTransfer.items.add(file));
      fileInput.files = dataTransfer.files;
      fileInput.dispatchEvent(new Event('change', { bubbles: true }));
      console.log('[AI Panel] ChatGPT files injected via input');

      // Wait for upload to complete
      await waitForUploadComplete();
      return true;
    }

    // Fallback: drag and drop
    const dropZone = document.querySelector('#prompt-textarea') ||
                     document.querySelector('[contenteditable="true"]') ||
                     document.querySelector('form');

    if (dropZone) {
      const dataTransfer = new DataTransfer();
      files.forEach(file => dataTransfer.items.add(file));

      const events = ['dragenter', 'dragover', 'drop'];
      for (const eventType of events) {
        const event = new DragEvent(eventType, {
          bubbles: true,
          cancelable: true,
          dataTransfer: dataTransfer
        });
        dropZone.dispatchEvent(event);
        await sleep(50);
      }

      console.log('[AI Panel] ChatGPT files injected via drop');
      await waitForUploadComplete();
      return true;
    }

    throw new Error('Could not find file input or drop zone');
  }

  // Wait for file upload to complete in ChatGPT
  async function waitForUploadComplete() {
    const maxWait = 30000; // 30 seconds max
    const checkInterval = 300;
    const startTime = Date.now();

    console.log('[AI Panel] ChatGPT waiting for upload to complete...');

    while (Date.now() - startTime < maxWait) {
      await sleep(checkInterval);

      // Check for upload progress indicators
      const uploadingIndicators = [
        // Progress bar or loading spinner
        '[role="progressbar"]',
        '[class*="uploading"]',
        '[class*="loading"]',
        // Circular progress
        'circle[stroke-dasharray]',
        // Any element with "uploading" text
        '[aria-label*="uploading"]',
        '[aria-label*="Uploading"]'
      ];

      let isUploading = false;
      for (const selector of uploadingIndicators) {
        const el = document.querySelector(selector);
        if (el && isVisible(el)) {
          isUploading = true;
          break;
        }
      }

      // Check if file preview/thumbnail appeared (upload complete indicator)
      const filePreviewIndicators = [
        // File attachment preview
        '[data-testid="file-thumbnail"]',
        '[class*="file-preview"]',
        '[class*="attachment"]',
        // Image preview
        'img[alt*="Uploaded"]',
        'img[src*="blob:"]'
      ];

      let hasPreview = false;
      for (const selector of filePreviewIndicators) {
        const el = document.querySelector(selector);
        if (el && isVisible(el)) {
          hasPreview = true;
          break;
        }
      }

      // If no longer uploading and has preview, we're done
      if (!isUploading && hasPreview) {
        console.log('[AI Panel] ChatGPT upload complete (preview detected)');
        await sleep(300); // Small extra delay for UI to stabilize
        return;
      }

      // If no uploading indicator and some time has passed, assume done
      if (!isUploading && Date.now() - startTime > 2000) {
        console.log('[AI Panel] ChatGPT upload assumed complete (no progress indicator)');
        await sleep(300);
        return;
      }
    }

    console.log('[AI Panel] ChatGPT upload wait timeout');
  }

  console.log('[AI Panel] ChatGPT content script loaded');
})();
