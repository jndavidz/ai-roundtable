// AI Panel - Claude Content Script
// Uses the shared controller from content/base.js; only site-specific config
// lives here: composer selectors, response extraction (with thinking-block
// filtering) and file injection.

(function() {
  'use strict';

  const AI_TYPE = 'claude';
  if (!window.AIPanelBase?.boot(AI_TYPE)) return;

  window.AIPanelBase.createController({
    aiType: AI_TYPE,
    name: 'Claude',

    // Claude uses a contenteditable rich-text editor. The exact attributes
    // change often, so prefer semantic textbox/composer signals over one class.
    inputSelectors: [
      'div.ProseMirror[contenteditable="true"][data-placeholder]',
      'div.ProseMirror[contenteditable]',
      'div[contenteditable="true"].ProseMirror',
      'div.ProseMirror[contenteditable="true"]',
      'div[contenteditable][data-placeholder*="Claude" i]',
      'div[contenteditable="true"][data-placeholder*="Claude" i]',
      'div[contenteditable][aria-label*="Claude" i]',
      'div[contenteditable="true"][aria-label*="Claude" i]',
      'div[contenteditable][aria-label*="message" i]',
      'div[contenteditable="true"][aria-label*="message" i]',
      'div[contenteditable][role="textbox"]',
      'div[contenteditable="true"][role="textbox"]',
      '[data-placeholder="How can Claude help you today?"]',
      '[data-placeholder*="How can" i][contenteditable]',
      '[data-placeholder*="How can" i][contenteditable="true"]',
      'fieldset div[contenteditable]'
    ],

    submitOptions: {
      selectors: [
        'button[data-testid="send-button"]',
        'button[aria-label*="Send message" i]',
        'button[aria-label="Send" i]',
        'button[type="submit"]',
        'fieldset button svg',
        'button svg[viewBox]'
      ],
      positivePattern: /(send|submit|发送|提交)/i,
      allowUnlabeledNearInput: true,
      enterFallback: true,
      maxWait: 6000,
      verifyMaxWait: 3000,
      submittingSelectors: [
        'button[aria-label*="Stop" i]',
        'button[data-testid*="stop" i]',
        '[data-is-streaming="true"]'
      ]
    },

    responseSelectors: [
      '[data-is-streaming]',
      '.font-claude-message',
      '[class*="response"]'
    ],

    streamingSelectors: [
      '[data-is-streaming="true"]',
      'button[aria-label*="Stop"]'
    ],

    getLatestResponse: function() {
      // Find the latest response container
      const responseContainers = document.querySelectorAll('[data-is-streaming="false"]');

      if (responseContainers.length === 0) return null;

      const lastContainer = responseContainers[responseContainers.length - 1];

      // Find all .standard-markdown blocks within this response
      const allBlocks = lastContainer.querySelectorAll('.standard-markdown');

      // Filter out thinking blocks:
      // Thinking blocks are inside containers with overflow-hidden and max-h-[238px]
      // or inside elements with "Thought process" button
      const responseBlocks = Array.from(allBlocks).filter(block => {
        // Check if this block is inside a thinking container
        const thinkingContainer = block.closest('[class*="overflow-hidden"][class*="max-h-"]');
        if (thinkingContainer) return false;

        // Check if ancestor has "Thought process" text
        const parent = block.closest('.font-claude-response');
        if (parent) {
          const buttons = parent.querySelectorAll('button');
          for (const btn of buttons) {
            if (btn.textContent.includes('Thought process') ||
                btn.textContent.includes('思考过程')) {
              // Check if block is descendant of this button's container
              const btnContainer = btn.closest('[class*="border-border-300"]');
              if (btnContainer && btnContainer.contains(block)) {
                return false;
              }
            }
          }
        }

        return true;
      });

      if (responseBlocks.length > 0) {
        // Join ALL non-thinking blocks: a single reply often spans several
        // markdown blocks (text + table + code section), and returning only
        // the last one silently dropped the rest of the answer.
        // CDP 实测 2026-09: 每块经 DOM→Markdown 序列化(表格管道行/引用链接/
        // 代码围栏/标题分级), 取代会压扁结构的 innerText。
        return responseBlocks
          .map(block => {
            if (!(window.AIPanelDom && window.AIPanelDom.toMarkdown)) {
              return block.innerText.trim();
            }
            const clone = block.cloneNode(true);
            clone.querySelectorAll('style, script').forEach(el => el.remove());
            return window.AIPanelDom.toMarkdown(clone).trim();
          })
          .filter(Boolean)
          .join('\n\n');
      }

      return null;
    },

    // File injection using DataTransfer API (input field, then drag-drop fallback)
    injectFiles: async function(filesData) {
      console.log('[AI Panel] Claude injecting files:', filesData.length);
      const files = window.AIPanelBase.base64ToFiles(filesData);

      // Find the file input
      const fileInput = document.querySelector('input[type="file"]');

      if (fileInput) {
        const dataTransfer = new DataTransfer();
        files.forEach(file => dataTransfer.items.add(file));
        fileInput.files = dataTransfer.files;
        fileInput.dispatchEvent(new Event('change', { bubbles: true }));
        console.log('[AI Panel] Claude files injected via input');
        await window.AIPanelBase.sleep(500);
        return true;
      }

      // Fallback: drag and drop on input area
      const dropZone = document.querySelector('div.ProseMirror[contenteditable="true"]') ||
                       document.querySelector('[contenteditable="true"]');

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

        console.log('[AI Panel] Claude files injected via drop');
        await window.AIPanelBase.sleep(500);
        return true;
      }

      throw new Error('Could not find file input or drop zone');
    }
  });
})();
