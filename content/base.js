// AI Panel - shared base for all AI content scripts
// Provides the standardized content-script lifecycle so each site file only
// configures the parts that differ: selectors, response extraction, streaming
// signals and (optionally) file injection.
//
// Requires content/dom-utils.js to be injected first (window.AIPanelDom).

(function() {
  'use strict';

  if (window.AIPanelBase) return;

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

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function isVisible(el) {
    if (!el) return false;
    const style = window.getComputedStyle(el);
    return style.display !== 'none' &&
           style.visibility !== 'hidden' &&
           style.opacity !== '0';
  }

  // Per-AI load guard: content scripts can be re-injected on navigation, but
  // only the first instance for the current extension version should run.
  function boot(aiType) {
    const LOAD_FLAG = '__AIPanelContentLoaded_' + aiType;
    const LOAD_VERSION = chrome.runtime?.getManifest?.().version || 'unknown';
    if (window[LOAD_FLAG] === LOAD_VERSION) return false;
    window[LOAD_FLAG] = LOAD_VERSION;
    return true;
  }

  // Convert base64 payloads (from the side panel) into File objects.
  function base64ToFiles(filesData) {
    return filesData.map(fileData => {
      const byteCharacters = atob(fileData.base64);
      const byteNumbers = new Array(byteCharacters.length);
      for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
      }
      const byteArray = new Uint8Array(byteNumbers);
      const blob = new Blob([byteArray], { type: fileData.type });
      return new File([blob], fileData.name, { type: fileData.type });
    });
  }

  // ===== Unified streaming capture =====
  // Multi-signal NEW content detection:
  //   Signal 1: message container count increased (when getMessageCount provided)
  //   Signal 2: content text changed from the pre-send snapshot
  //   Signal 3: streaming indicator active (getStreamingSignal / streamingSelectors)
  // Plus a 45s fallback capture and a stale-streaming force-capture, so a
  // response is captured even when the site's streaming indicator never shows.
  function createCapture(config) {
    const {
      aiType,
      name,
      getLatestResponse,
      getMessageCount,
      getCaptureAbortError,
      maxWait = 600000,        // 10 minutes absolute cap
      checkInterval = 500,
      stableThreshold = 4,     // ~2s of stable content
      fallbackTimeout = 45000, // if no signal fired, try fallback detection
      staleStreamingTimeout = 15000
    } = config;

    const getStreamingSignal = config.getStreamingSignal ||
      (config.streamingSelectors
        ? () => config.streamingSelectors.some(s => document.querySelector(s))
        : () => false);
    // Sites WITHOUT any streaming signal can't distinguish "model is thinking
    // mid-answer" from "answer finished", so the plain stability path (2s of
    // unchanged text) risks capturing a truncated reply at a thinking pause.
    // For those, require a longer quiet window before the stable-path capture;
    // the content-settled force-capture below still bounds the extra latency.
    const hasStreamingSignal = Boolean(config.getStreamingSignal || config.streamingSelectors);
    const effStableThreshold = hasStreamingSignal
      ? stableThreshold
      : Math.max(stableThreshold, 8); // ~4s of unchanged content

    let isCapturing = false;
    let lastCapturedContent = '';
    let lastCapturedAt = 0;
    // Observer-triggered captures are a fallback path; suppress them for a
    // short window after any successful capture so a single streaming response
    // doesn't get reported twice (once by injectMessage's capture, once by the
    // MutationObserver).
    const OBSERVER_COOLDOWN_MS = 10000;

    async function captureResponse({ preSendContent = '', source = 'inject' } = {}) {
      if (source === 'observer' && Date.now() - lastCapturedAt < OBSERVER_COOLDOWN_MS) {
        console.log('[AI Panel]', name, 'observer capture skipped (recently captured)');
        return;
      }
      if (isCapturing) {
        console.log('[AI Panel]', name, 'already capturing, skipping...');
        return;
      }
      isCapturing = true;

      let previousContent = '';
      let stableCount = 0;
      let stableLenTicks = 0;
      let newContentDetected = false;
      let lastStreamingTime = 0;
      const startTime = Date.now();
      const preSendContainerCount = getMessageCount ? getMessageCount() : 0;
      // How long the response text must be essentially settled (length within
      // a small tolerance between polls) before we force-capture. Independent
      // of the streaming indicator — some sites keep their "stop" button (our
      // streaming signal) in the DOM after the answer is complete, and the
      // captured block may flicker slightly (blinking cursor / live counters),
      // both of which previously left the debate stuck on "speaking" for
      // minutes until the page was manually touched.
      const contentStableTimeout = config.contentStableTimeout ?? 3000;
      const contentStableTolerance = config.contentStableTolerance ?? 5;

      try {
        while (Date.now() - startTime < maxWait) {
          if (!isContextValid()) {
            console.log('[AI Panel] Context invalidated, stopping capture');
            return;
          }

          // Some sites lose the session mid-debate; allow an explicit abort
          const abortError = getCaptureAbortError ? getCaptureAbortError() : null;
          if (abortError) {
            safeSendMessage({
              type: 'RESPONSE_CAPTURED',
              aiType,
              content: null,
              error: abortError
            });
            return;
          }

          await sleep(checkInterval);

          const currentContent = getLatestResponse() || '';
          const currentContainerCount = getMessageCount ? getMessageCount() : 0;
          const isStreaming = getStreamingSignal();

          if (isStreaming) {
            lastStreamingTime = Date.now();
          }

          if (!newContentDetected) {
            const containerIncreased = currentContainerCount > preSendContainerCount;
            const contentChanged = currentContent && currentContent !== preSendContent;
            if (containerIncreased || contentChanged || isStreaming) {
              newContentDetected = true;
              console.log('[AI Panel]', name, 'NEW content detected —',
                'contentChanged:', !!contentChanged,
                ', streaming:', isStreaming,
                ', contentLen:', currentContent.length);
            }
          }

          // Fallback: if no signal fired but content differs after the fallback
          // window, capture it anyway (site signals may have changed).
          if (!newContentDetected && Date.now() - startTime > fallbackTimeout) {
            if ((currentContent && currentContent !== preSendContent) ||
                currentContainerCount > preSendContainerCount) {
              console.log('[AI Panel]', name, 'fallback capture — content changed but no signal fired');
              newContentDetected = true;
            }
          }

          if (newContentDetected) {
            const streamingStopped = !isStreaming && (Date.now() - lastStreamingTime > 2000);
            if (streamingStopped && currentContent === previousContent && currentContent.length > 0) {
              stableCount++;
              if (stableCount >= effStableThreshold) {
                // Final guard: don't capture content identical to the pre-send state
                if (currentContent === preSendContent) {
                  console.log('[AI Panel]', name, 'content same as pre-send, continuing to wait...');
                  stableCount = 0;
                  previousContent = currentContent;
                  continue;
                }
                if (currentContent === lastCapturedContent) return; // already reported
                lastCapturedContent = currentContent;
                lastCapturedAt = Date.now();
                safeSendMessage({
                  type: 'RESPONSE_CAPTURED',
                  aiType,
                  content: currentContent
                });
                console.log('[AI Panel]', name, 'response captured, length:', currentContent.length);
                return;
              }
            } else {
              stableCount = 0;
            }

            // Force-capture once the response text has essentially settled —
            // length within a small tolerance between polls. This works even
            // when the streaming indicator is stuck on AND tolerates tiny
            // flicker (blinking cursor / live counters / re-renders) that
            // keeps exact-equality checks from ever passing.
            const lenDelta = Math.abs(currentContent.length - previousContent.length);
            if (currentContent.length > 0 &&
                currentContent !== preSendContent &&
                currentContent !== lastCapturedContent &&
                lenDelta <= contentStableTolerance) {
              stableLenTicks++;
              if (stableLenTicks * checkInterval >= contentStableTimeout) {
                lastCapturedContent = currentContent;
                lastCapturedAt = Date.now();
                safeSendMessage({
                  type: 'RESPONSE_CAPTURED',
                  aiType,
                  content: currentContent
                });
                console.log('[AI Panel]', name, 'content settled, force-captured, length:', currentContent.length);
                return;
              }
            } else {
              stableLenTicks = 0;
            }
          }

          previousContent = currentContent;
        }
        console.log('[AI Panel]', name, 'capture timeout after', maxWait / 1000, 'seconds');
      } finally {
        isCapturing = false;
      }
    }

    return { captureResponse, isCapturing: () => isCapturing };
  }

  // ===== Response observer =====
  // Watches for new response nodes; when one appears, starts a capture.
  // captureResponse is guarded by its own isCapturing flag, so overlapping
  // triggers from injectMessage and the observer are deduplicated.
  function createResponseObserver(config, capture) {
    if (!config.responseSelectors || config.responseSelectors.length === 0) return;

    let observer = null;

    function handleNode(node) {
      if (node.nodeType !== Node.ELEMENT_NODE) return;
      for (const selector of config.responseSelectors) {
        if (node.matches?.(selector) || node.querySelector?.(selector)) {
          console.log('[AI Panel]', config.name, 'detected new response...');
          capture.captureResponse({ source: 'observer' }); // observer path has no pre-send snapshot
          break;
        }
      }
    }

    const callback = (mutations) => {
      if (!isContextValid()) {
        observer?.disconnect();
        return;
      }
      for (const mutation of mutations) {
        if (mutation.type === 'childList') {
          for (const node of mutation.addedNodes) handleNode(node);
        }
      }
    };

    const startObserving = () => {
      if (!isContextValid()) return;
      // Sites that know their conversation container can narrow the root via
      // config.observerRoot; default keeps the historical main/body fallback.
      const root = (config.observerRoot && config.observerRoot()) ||
                   document.querySelector('main') ||
                   document.body;
      observer = new MutationObserver(callback);
      observer.observe(root, { childList: true, subtree: true });
    };

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', startObserving);
    } else {
      startObserving();
    }
  }

  // ===== Controller factory =====

  // Default response extractor: walk the selector list in order and take the
  // last matching block. Nine of the twelve site adapters use exactly this
  // shape, so adapters only need a custom getLatestResponse when they do
  // something extra (thinking-block filtering, multi-part joins, ...).
  //
  // When dom-utils is present (manifest injects it first) the block is run
  // through the DOM→Markdown serializer: tables become pipe rows, citations
  // become [text](href) links, code blocks become fenced blocks, headings and
  // paragraphs keep their line structure. Adapters can declare
  // extractNoiseSelectors to strip site-specific noise (badges, action bars)
  // from the clone before serialization.
  function serializeExtract(node, noiseSelectors) {
    const clone = node.cloneNode(true);
    clone.querySelectorAll('style, script').forEach(el => el.remove());
    (noiseSelectors || []).forEach(sel => {
      try { clone.querySelectorAll(sel).forEach(el => el.remove()); } catch (e) { /* bad selector: skip */ }
    });
    let md = window.AIPanelDom.toMarkdown(clone);
    return md
      .replace(/^\s*\w*\s*(表格|复制|下载|代码预览|代码|预览)\s*$/gmi, '')
      .replace(/```\s*\n+```/g, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  function makeDefaultGetLatestResponse(responseSelectors, noiseSelectors) {
    return function () {
      for (const selector of responseSelectors) {
        const blocks = document.querySelectorAll(selector);
        if (blocks.length === 0) continue;
        const node = blocks[blocks.length - 1];
        if (window.AIPanelDom && window.AIPanelDom.toMarkdown) {
          const md = serializeExtract(node, noiseSelectors);
          if (md) return md;
        }
        return node.innerText.trim();
      }
      return null;
    };
  }

  function createController(config) {
    const { aiType, name } = config;

    // Fill in standard behavior so site configs stay minimal:
    //   getLatestResponse   ← derive from responseSelectors when omitted
    //   streamingSelectors  ← reuse submittingSelectors when omitted (on most
    //                         sites the "stop" UI doubles as both signals)
    const effectiveConfig = {
      ...config,
      getLatestResponse: config.getLatestResponse ||
        ((config.responseSelectors && config.responseSelectors.length > 0)
          ? makeDefaultGetLatestResponse(config.responseSelectors, config.extractNoiseSelectors)
          : null),
      streamingSelectors: config.streamingSelectors ||
        config.submitOptions?.submittingSelectors
    };

    // Notify background that content script is ready
    safeSendMessage({ type: 'CONTENT_SCRIPT_READY', aiType });

    const capture = createCapture(effectiveConfig);
    createResponseObserver(effectiveConfig, capture);

    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.type === 'INJECT_MESSAGE') {
        injectMessage(message.message)
          .then(() => sendResponse({ success: true }))
          .catch(err => sendResponse({ success: false, error: err.message }));
        return true;
      }

      if (message.type === 'INJECT_FILES' && config.injectFiles) {
        config.injectFiles(message.files)
          .then(() => sendResponse({ success: true }))
          .catch(err => sendResponse({ success: false, error: err.message }));
        return true;
      }

      if (message.type === 'GET_LATEST_RESPONSE') {
        sendResponse({ content: effectiveConfig.getLatestResponse ? effectiveConfig.getLatestResponse() : null });
        return true;
      }

      // Composer-readiness probe: content script alive is NOT enough for a
      // freshly opened SPA tab — React/Angular mount the composer a few
      // seconds after our document_idle injection. ENSURE_TAB polls this so
      // the fan-out only starts once the input field actually exists.
      if (message.type === 'CHECK_INPUT') {
        let ready = false;
        try {
          ready = !!(window.AIPanelDom && window.AIPanelDom.findInputField(
            config.inputSelectors, { preferBottom: true }));
        } catch (e) { ready = false; }
        sendResponse({ ready });
        return true;
      }

      // Liveness probe used by the side panel to verify this script is alive
      if (message.type === 'PING') {
        sendResponse({ pong: true });
        return true;
      }
    });

    async function injectMessage(text) {
      // Some sites need a login/session check before we touch the composer
      if (config.loginCheck) config.loginCheck();

      const inputEl = window.AIPanelDom?.findInputField(config.inputSelectors, { preferBottom: true });
      if (!inputEl) throw new Error(`Could not find ${name} input field`);

      // Snapshot content BEFORE submitting. Taken after the send, an instant
      // one-shot reply would already be part of the "pre-send" state and every
      // diff-based new-content signal would miss it until the 10min timeout.
      const preSendContent = effectiveConfig.getLatestResponse ? (effectiveConfig.getLatestResponse() || '') : '';

      await window.AIPanelDom.setEditorText(inputEl, text, { afterInputDelay: config.afterInputDelay ?? 500 });

      const submitResult = await window.AIPanelDom.submitMessage(inputEl, config.submitOptions).catch(async (err) => {
        // 后台标签限制: gemini 等 Angular/Quill 站点在 hidden 标签里点击发送
        // 无效(实测 visible="hidden" 时 setText 后点击无反应; 用户观察到
        // 「只有手动点开 Gemini 标签才会激活对话」)。请求 background 激活
        // 本标签, 等页面恢复可见后重新写入并提交一次。
        if (!/Submit did not start|remained unchanged/i.test(err.message || '')) throw err;
        console.log('[AI Panel]', name, 'submit failed in background tab, activating tab and retrying...');
        try { await chrome.runtime.sendMessage({ type: 'ACTIVATE_TAB' }); } catch (e2) { /* sidepanel closed etc */ }
        await new Promise((resolve) => {
          if (document.visibilityState === 'visible') return resolve();
          const onVis = () => {
            if (document.visibilityState === 'visible') {
              document.removeEventListener('visibilitychange', onVis);
              resolve();
            }
          };
          document.addEventListener('visibilitychange', onVis);
          // 兜底加长: 窗口还原+聚焦需要时间, 2.5s 实测不够(hidden 下重试
          // 依然无效, 豆包/gemini 输入框残留即此)
          setTimeout(resolve, 8000);
        });
        // 激活后重新写入: gemini 的编辑器是 Quill(hidden 时 model 不同步,
        // 这是发送无效的深层原因), 优先用 Quill 实例 API 保证 model 同步;
        // 其他编辑器退回 execCommand 路径
        let quill = null;
        try {
          let n = inputEl;
          for (let i = 0; i < 6 && n; i++) {
            if (n.__quill && typeof n.__quill.setText === 'function') { quill = n.__quill; break; }
            n = n.parentElement;
          }
        } catch (e2) { /* probe failure: fall through */ }
        if (quill) {
          quill.setText(text);
          await sleep(config.afterInputDelay ?? 500);
        } else {
          await window.AIPanelDom.setEditorText(inputEl, text, { afterInputDelay: config.afterInputDelay ?? 500 });
        }
        return await window.AIPanelDom.submitMessage(inputEl, config.submitOptions);
      });
      console.log('[AI Panel]', name, 'message sent via', submitResult.method, 'starting response capture...');

      // 后台标签的捕获循环会被 Chrome intensive throttling 拖到分钟级
      // (实测 deepseek/qianwen 发送后 20+ 分钟才捕获, 用户点开标签立即恢复)。
      // 发送成功后若本标签不可见, 请求 background 激活自己——用户会看到标签
      // 依次弹出聚焦, 这是实时捕获的代价; 用户正看的标签不会被打扰。
      if (document.visibilityState === 'hidden') {
        try { await chrome.runtime.sendMessage({ type: 'ACTIVATE_TAB' }); } catch (e3) { /* ignore */ }
      }

      capture.captureResponse({ preSendContent });
      return true;
    }
  }

  console.log('[AI Panel] base loaded');

  window.AIPanelBase = {
    boot,
    base64ToFiles,
    createController,
    isVisible,
    sleep,
    _test: { createCapture }
  };
})();
