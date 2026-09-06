// AI Panel - ChatGPT Content Script
// Uses the shared controller from content/base.js; site-specific config only:
// login guard, composer selectors, send button strategy, multi-signal response
// detection (container count + content diff + streaming) and file injection.

(function() {
  'use strict';

  const AI_TYPE = 'chatgpt';
  if (!window.AIPanelBase?.boot(AI_TYPE)) return;

  window.AIPanelBase.createController({
    aiType: AI_TYPE,
    name: 'ChatGPT',
    afterInputDelay: 100, // small delay for React to process the input

    // Guard: if ChatGPT redirected to login/auth page, abort immediately.
    // The login page has a textarea (email input) that would be falsely matched.
    loginCheck: function() {
      if (location.pathname.includes('/auth/login') || location.pathname.includes('/auth/')) {
        throw new Error('ChatGPT 未登录，请在 ChatGPT 标签页中登录后重试');
      }
    },

    // ChatGPT uses a contenteditable div (previously textarea, changed in 2025+)
    inputSelectors: [
      '#prompt-textarea',
      'div[contenteditable="true"]#prompt-textarea',
      'div[contenteditable="true"][data-placeholder]',
      'textarea[data-id="root"]',
      'textarea[placeholder*="Message"]',
      'div[contenteditable="true"][role="textbox"]'
      // NOTE: bare 'textarea' removed — it falsely matches the login page email input
    ],

    submitOptions: {
      selectors: [
        'button[data-testid="send-button"]',
        'button[aria-label="Send prompt"]',
        'button[aria-label="Send message"]',
        'form button[type="submit"]',
        'button svg path[d*="M15.192"]' // Arrow icon path
      ],
      positivePattern: /(send|submit|发送|提交)/i,
      allowUnlabeledNearInput: false,
      enterFallback: true,
      maxWait: 6000,
      verifyMaxWait: 3000,
      submittingSelectors: [
        'button[aria-label*="Stop"]',
        'button[data-testid="stop-button"]',
        'button[aria-label*="停止"]',
        'button[aria-label*="stop"]',
        'button[data-testid*="stop"]',
        // Additional: ChatGPT sometimes uses a different stop button layout
        'button[aria-label*="Stream"]'
      ]
    },

    responseSelectors: [
      '[data-message-author-role="assistant"]',
      '.agent-turn',
      '[class*="assistant"]'
    ],

    // Same stop-button selectors drive the streaming signal during capture
    streamingSelectors: [
      'button[aria-label*="Stop"]',
      'button[data-testid="stop-button"]',
      'button[aria-label*="停止"]',
      'button[aria-label*="stop"]',
      'button[data-testid*="stop"]',
      'button[aria-label*="Stream"]'
    ],

    // Count assistant message containers — reliable signal for new message detection
    getMessageCount: function() {
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
    },

    // Abort capture if the session expired mid-debate (navigated to login page)
    getCaptureAbortError: function() {
      if (location.pathname.includes('/auth/')) {
        return 'ChatGPT 会话已过期，请重新登录';
      }
      return null;
    },

    // getLatestResponse 已删除: base.js 默认派生取 [data-message-author-role=
    // "assistant"] 最后块, 经 DOM→Markdown 序列化(表格管道行/引用链接/代码围栏/
    // 标题分级), 旧版多块 innerText 拼接会把块间都插空行(实测 902 行碎块)。
    extractNoiseSelectors: [
      '[data-testid*="citation"]',
      '[class*="citation"]'
    ],


    // File injection using DataTransfer API (input field, then drag-drop fallback)
    injectFiles: async function(filesData) {
      console.log('[AI Panel] ChatGPT injecting files:', filesData.length);
      const files = window.AIPanelBase.base64ToFiles(filesData);

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
          await window.AIPanelBase.sleep(50);
        }

        console.log('[AI Panel] ChatGPT files injected via drop');
        await waitForUploadComplete();
        return true;
      }

      throw new Error('Could not find file input or drop zone');
    }
  });

  // Wait for file upload to complete in ChatGPT
  async function waitForUploadComplete() {
    const maxWait = 30000; // 30 seconds max
    const checkInterval = 300;
    const startTime = Date.now();
    const sleep = window.AIPanelBase.sleep;
    const isVisible = window.AIPanelBase.isVisible;

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
})();
