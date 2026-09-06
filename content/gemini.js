// AI Panel - Gemini Content Script
// Uses the shared controller from content/base.js; site-specific config only:
// composer selectors, response extraction and the multi-strategy file upload.

(function() {
  'use strict';

  const AI_TYPE = 'gemini';
  if (!window.AIPanelBase?.boot(AI_TYPE)) return;

  window.AIPanelBase.createController({
    aiType: AI_TYPE,
    name: 'Gemini',
    afterInputDelay: 650,

    // Gemini uses a rich text editor (contenteditable or textarea)
    inputSelectors: [
      '.ql-editor[contenteditable="true"]',
      'rich-textarea [contenteditable="true"]',
      'div[contenteditable="true"][aria-label*="prompt" i]',
      'div[contenteditable="true"][aria-label*="message" i]',
      'div[contenteditable="true"][aria-label*="Ask" i]',
      'div[contenteditable="true"][role="textbox"]',
      'rich-textarea textarea',
      'textarea[aria-label*="Type something" i]',
      'textarea[aria-label*="prompt"]',
      'textarea[placeholder*="Enter"]',
      '.input-area textarea',
      'div[contenteditable="true"]',
      'textarea'
    ],

    submitOptions: {
      selectors: [
        'button[aria-label*="Send" i]',
        'button[aria-label*="Submit" i]',
        'button[aria-label*="Run" i]',
        'button[mattooltip*="Send" i]',
        'button[mattooltip*="Run" i]',
        'button[data-test-id*="send" i]',
        'button[data-testid*="send" i]',
        'button.send-button',
        '.input-area button',
        'button mat-icon[data-mat-icon-name="send"]'
      ],
      positivePattern: /(send|submit|run|发送|提交|运行)/i,
      enterFallback: true,
      maxWait: 7000,
      afterClickDelay: 900,
      verifyMaxWait: 4000,
      // Gemini replaces the send button with a stop button / spinner while
      // generating. Detect that as the "submission started" signal, since the
      // composer textarea isn't always cleared right away and previously caused
      // false "Submit did not start" failures even though the message went out.
      submittingSelectors: [
        'button[aria-label*="Stop" i]',
        'button[aria-label*="stop generating" i]',
        'button[mattooltip*="Stop" i]',
        'button[data-test-id*="stop" i]',
        'button[data-testid*="stop" i]',
        'mat-spinner'
      ]
    },

    responseSelectors: [
      // message-content 优先: 它是完整回复容器, 含 table-block-component 表格;
      // .model-response-text 只是其中的纯文本部分, 用它表格会丢(实测 1722 字大段)
      'message-content',
      '.model-response-text'
    ],

    // Gemini has no reliable streaming indicator; rely on content-stability
    // detection (no streamingSelectors => streaming signal is always false).

    // getLatestResponse 已删除: base.js 默认派生取 .model-response-text 最后块
    // 经 DOM→Markdown 序列化。chat-history/upgrade 标题在容器外, 不会被抓入。
    extractNoiseSelectors: [
      // 注意: 不能用 [class*="citation"]——gemini 正文文本全在 span.citation-7
      // 里, 剥掉它们等于删正文(实测输出 ****`` 且整句丢失)。只剥真正的来源
      // 卡片元素(自定义标签, 不承载正文):
      'sources-carousel-inline',
      'source-inline-chip'
    ],


    // File injection for Gemini. Gemini's UI changes frequently, so try the
    // supported browser surfaces in order: file input, paste, then drop.
    injectFiles: async function(filesData) {
      console.log('[AI Panel] Gemini injecting files:', filesData.length);
      const files = window.AIPanelBase.base64ToFiles(filesData);
      const sleep = window.AIPanelBase.sleep;

      const beforeSnapshot = getUploadSnapshot(files);
      const attempts = [];

      if (await tryGeminiFileInputUpload(files, beforeSnapshot)) {
        console.log('[AI Panel] Gemini files injected via file input');
        return true;
      }
      attempts.push('file input');

      if (await tryGeminiPasteUpload(files, beforeSnapshot)) {
        console.log('[AI Panel] Gemini files injected via paste event');
        return true;
      }
      attempts.push('paste');

      if (await tryGeminiDropUpload(files, beforeSnapshot)) {
        console.log('[AI Panel] Gemini files injected via drop event');
        return true;
      }
      attempts.push('drop');

      throw new Error(`Gemini 文件上传未被页面接受（已尝试: ${attempts.join(', ')}）。请手动上传，或打开 Gemini 页面 console 查看 [AI Panel] Gemini upload 日志。`);
    }
  });

  // ===== Gemini file upload helpers =====

  async function tryGeminiFileInputUpload(files, beforeSnapshot) {
    await revealGeminiFileInputs();

    const fileInputs = getFileInputCandidates(files);
    console.log('[AI Panel] Gemini file input candidates:', fileInputs.length);

    for (const fileInput of fileInputs) {
      try {
        const dataTransfer = createFileDataTransfer(files);
        fileInput.files = dataTransfer.files;
        dispatchFileInputEvents(fileInput, dataTransfer);

        if (await waitForGeminiUploadAccepted(files, beforeSnapshot, 8000)) {
          return true;
        }
      } catch (e) {
        console.log('[AI Panel] Gemini file input injection error:', e.message);
      }
    }

    return false;
  }

  async function revealGeminiFileInputs() {
    const beforeCount = document.querySelectorAll('input[type="file"]').length;
    const buttons = findUploadButtons();
    console.log('[AI Panel] Gemini upload buttons:', buttons.length, 'file inputs before:', beforeCount);

    try {
      for (const btn of buttons.slice(0, 4)) {
        clickElement(btn);
        await window.AIPanelBase.sleep(350);

        const menuItems = findUploadMenuItems();
        for (const item of menuItems.slice(0, 3)) {
          clickElement(item);
          await window.AIPanelBase.sleep(350);
          if (document.querySelectorAll('input[type="file"]').length > beforeCount) return;
        }

        if (document.querySelectorAll('input[type="file"]').length > beforeCount) return;
      }
    } finally {
      closeStrayMenus();
    }
  }

  // Probing clicks can leave upload menus/dialogs open on failure; send an
  // Escape to the page so the UI returns to its resting state.
  function closeStrayMenus() {
    const target = document.activeElement || document.body;
    target.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true, cancelable: true
    }));
  }

  function findUploadButtons() {
    const selectors = [
      'button[aria-label*="Add files" i]',
      'button[aria-label*="Upload" i]',
      'button[aria-label*="Attach" i]',
      'button[aria-label*="Add" i]',
      'button[aria-label*="file" i]',
      'button[mattooltip*="Add files" i]',
      'button[mattooltip*="Upload" i]',
      'button[mattooltip*="Attach" i]',
      'button[data-test-id*="upload" i]',
      'button[data-testid*="upload" i]'
    ];
    const matches = collectElements(selectors).filter(window.AIPanelBase.isVisible);
    const buttons = Array.from(document.querySelectorAll('button, [role="button"]')).filter(el => {
      if (!window.AIPanelBase.isVisible(el)) return false;
      const label = getElementLabel(el).toLowerCase();
      return /(add files|upload|attach|file|image|photo|添加文件|上传|附件|图片|照片)/i.test(label);
    });

    return uniqueElements([...matches, ...buttons]);
  }

  function findUploadMenuItems() {
    const selectors = [
      '[role="menuitem"]',
      '[role="option"]',
      'button',
      'li',
      '[data-test-id*="upload" i]',
      '[data-testid*="upload" i]'
    ];

    return collectElements(selectors).filter(el => {
      if (!window.AIPanelBase.isVisible(el)) return false;
      const label = getElementLabel(el).toLowerCase();
      return /(upload|files|file|device|computer|image|photo|上传|文件|本机|电脑|图片|照片)/i.test(label) &&
             !/(drive|camera|photos|notebook|google drive|相机|云端硬盘|notebooklm)/i.test(label);
    });
  }

  function getFileInputCandidates(files) {
    const inputs = Array.from(document.querySelectorAll('input[type="file"]'));
    const scored = inputs.map(input => ({ input, score: scoreFileInput(input, files) }))
      .filter(item => item.score > -Infinity)
      .sort((a, b) => b.score - a.score);

    return scored.map(item => item.input);
  }

  function scoreFileInput(input, files) {
    const accept = (input.getAttribute('accept') || '').toLowerCase();
    const label = getElementLabel(input).toLowerCase();
    let score = 0;

    if (!input.disabled) score += 10;
    if (input.multiple || files.length === 1) score += 10;
    if (/image|file|upload|attach|gemini|上传|文件|图片/.test(`${accept} ${label}`)) score += 20;
    if (!accept) score += 5;

    for (const file of files) {
      const type = (file.type || '').toLowerCase();
      const ext = `.${file.name.split('.').pop()?.toLowerCase() || ''}`;
      if (!accept ||
          accept.includes(type) ||
          accept.includes(type.split('/')[0] + '/*') ||
          accept.includes(ext)) {
        score += 10;
      } else {
        score -= 30;
      }
    }

    return score;
  }

  async function tryGeminiPasteUpload(files, beforeSnapshot) {
    const target = findGeminiUploadTarget();
    if (!target) return false;

    const dataTransfer = createFileDataTransfer(files);
    target.focus?.();

    let event;
    try {
      event = new ClipboardEvent('paste', {
        bubbles: true,
        cancelable: true,
        clipboardData: dataTransfer
      });
    } catch (err) {
      event = new Event('paste', { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'clipboardData', { value: dataTransfer });
    }

    target.dispatchEvent(event);
    return await waitForGeminiUploadAccepted(files, beforeSnapshot, 8000);
  }

  async function tryGeminiDropUpload(files, beforeSnapshot) {
    const target = findGeminiUploadTarget();
    if (!target) return false;

    const dataTransfer = createFileDataTransfer(files);
    const events = ['dragenter', 'dragover', 'drop'];

    for (const eventType of events) {
      const event = new DragEvent(eventType, {
        bubbles: true,
        cancelable: true,
        dataTransfer
      });
      target.dispatchEvent(event);
      await window.AIPanelBase.sleep(80);
    }

    return await waitForGeminiUploadAccepted(files, beforeSnapshot, 8000);
  }

  function dispatchFileInputEvents(fileInput, dataTransfer) {
    const eventOptions = { bubbles: true, cancelable: true, composed: true };
    fileInput.dispatchEvent(new Event('input', eventOptions));
    fileInput.dispatchEvent(new Event('change', eventOptions));
    fileInput.dispatchEvent(new CustomEvent('change', {
      ...eventOptions,
      detail: { files: dataTransfer.files }
    }));
  }

  function findGeminiUploadTarget() {
    const selectors = [
      '.ql-editor[contenteditable="true"]',
      'rich-textarea [contenteditable="true"]',
      'div[contenteditable="true"][role="textbox"]',
      'div[contenteditable="true"]',
      'rich-textarea textarea',
      'textarea',
      'main',
      '.conversation-container'
    ];

    return collectElements(selectors).find(window.AIPanelBase.isVisible) || document.body;
  }

  function createFileDataTransfer(files) {
    const dataTransfer = new DataTransfer();
    files.forEach(file => dataTransfer.items.add(file));
    return dataTransfer;
  }

  async function waitForGeminiUploadAccepted(files, beforeSnapshot, maxWait) {
    const start = Date.now();
    while (Date.now() - start < maxWait) {
      const snapshot = getUploadSnapshot(files);
      if (snapshot.acceptedCount > beforeSnapshot.acceptedCount) return true;
      if (snapshot.hasFileName && !beforeSnapshot.hasFileName) return true;
      if (snapshot.hasAttachmentUi && snapshot.attachmentUiCount > beforeSnapshot.attachmentUiCount) return true;
      await window.AIPanelBase.sleep(250);
    }
    return false;
  }

  function getUploadSnapshot(files) {
    const text = document.body.innerText || '';
    // Count occurrences so a filename that merely stays visible (mentioned in
    // the conversation, etc.) doesn't read as newly-accepted evidence.
    const hasFileName = files.some(file => text.includes(file.name));
    const attachmentSelectors = [
      '[aria-label*="Remove" i]',
      '[aria-label*="Delete" i]',
      '[aria-label*="attached" i]',
      '[aria-label*="attachment" i]',
      '[data-test-id*="attachment" i]',
      '[data-testid*="attachment" i]',
      '[data-test-id*="file" i]',
      '[data-testid*="file" i]',
      'mat-chip',
      '[class*="attachment" i]',
      '[class*="file-chip" i]',
      '[class*="upload" i]'
    ];
    const attachmentUiCount = collectElements(attachmentSelectors).filter(window.AIPanelBase.isVisible).length;
    const acceptedCount = files.reduce((count, file) => count + (text.includes(file.name) ? 1 : 0), 0);

    return {
      acceptedCount,
      hasFileName,
      hasAttachmentUi: attachmentUiCount > 0,
      attachmentUiCount
    };
  }

  function getElementLabel(el) {
    if (!el) return '';
    return [
      el.getAttribute?.('aria-label'),
      el.getAttribute?.('title'),
      el.getAttribute?.('mattooltip'),
      el.getAttribute?.('data-testid'),
      el.getAttribute?.('data-test-id'),
      el.getAttribute?.('accept'),
      el.innerText,
      el.textContent
    ].filter(Boolean).join(' ');
  }

  function collectElements(selectors) {
    const elements = [];
    const seen = new Set();
    for (const selector of selectors) {
      for (const el of document.querySelectorAll(selector)) {
        if (!seen.has(el)) {
          seen.add(el);
          elements.push(el);
        }
      }
    }
    return elements;
  }

  function uniqueElements(elements) {
    return Array.from(new Set(elements));
  }

  function clickElement(el) {
    const eventOptions = { bubbles: true, cancelable: true, view: window };
    try {
      el.dispatchEvent(new PointerEvent('pointerdown', eventOptions));
      el.dispatchEvent(new MouseEvent('mousedown', eventOptions));
      el.dispatchEvent(new PointerEvent('pointerup', eventOptions));
      el.dispatchEvent(new MouseEvent('mouseup', eventOptions));
    } catch (err) {
      el.dispatchEvent(new MouseEvent('mousedown', eventOptions));
      el.dispatchEvent(new MouseEvent('mouseup', eventOptions));
    }
    el.click?.();
  }
})();
