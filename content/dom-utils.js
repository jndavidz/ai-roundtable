// AI Panel - shared DOM helpers for AI web chat pages

(function() {
  'use strict';

  if (window.AIPanelDom) return;

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function isVisible(el) {
    if (!el) return false;
    const style = window.getComputedStyle(el);
    const rect = el.getBoundingClientRect?.();
    return style.display !== 'none' &&
           style.visibility !== 'hidden' &&
           style.opacity !== '0' &&
           (!rect || rect.width > 0 || rect.height > 0);
  }

  function isDisabled(el) {
    return Boolean(
      el?.disabled ||
      el?.hasAttribute?.('disabled') ||
      el?.getAttribute?.('aria-disabled') === 'true' ||
      el?.closest?.('[aria-disabled="true"]')
    );
  }

  function getNodeLabel(el) {
    if (!el) return '';
    const icon = el.querySelector?.('mat-icon, [data-mat-icon-name], svg[aria-label], svg[title]');
    return [
      el.getAttribute?.('aria-label'),
      el.getAttribute?.('title'),
      el.getAttribute?.('mattooltip'),
      el.getAttribute?.('data-testid'),
      el.getAttribute?.('data-test-id'),
      el.getAttribute?.('data-tooltip'),
      icon?.getAttribute?.('aria-label'),
      icon?.getAttribute?.('title'),
      icon?.getAttribute?.('data-mat-icon-name'),
      icon?.textContent,
      el.innerText,
      el.textContent
    ].filter(Boolean).join(' ').trim();
  }

  function getElementText(el) {
    if (!el) return '';
    if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
      return el.value || '';
    }
    return el.innerText || el.textContent || '';
  }

  function dispatchInput(el, inputType, data) {
    let event;
    try {
      event = new InputEvent('input', {
        bubbles: true,
        cancelable: true,
        inputType,
        data
      });
    } catch (err) {
      event = new Event('input', { bubbles: true, cancelable: true });
    }
    el.dispatchEvent(event);
  }

  function dispatchBeforeInput(el, inputType, data) {
    try {
      el.dispatchEvent(new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        inputType,
        data
      }));
    } catch (err) {
      // beforeinput is best-effort for rich text editors.
    }
  }

  function setNativeValue(el, value) {
    const proto = el.tagName === 'TEXTAREA'
      ? window.HTMLTextAreaElement?.prototype
      : window.HTMLInputElement?.prototype;
    const descriptor = proto && Object.getOwnPropertyDescriptor(proto, 'value');

    if (descriptor?.set) {
      descriptor.set.call(el, value);
    } else {
      el.value = value;
    }
  }

  function selectElementContents(el) {
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(el);
    selection.removeAllRanges();
    selection.addRange(range);
  }

  function setSelectionToEnd(el) {
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);
  }

  function activateElement(el) {
    el.scrollIntoView?.({ block: 'center', inline: 'nearest' });

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
    el.focus();
  }

  function setEditableFallback(el, text) {
    const paragraphs = String(text).split('\n').map(line => {
      const div = document.createElement('div');
      div.textContent = line || '\u00a0';
      return `<p>${div.innerHTML}</p>`;
    }).join('');
    el.innerHTML = paragraphs || '<p><br></p>';
  }

  async function setEditorText(el, text, options = {}) {
    if (!el) throw new Error('Input element is required');

    activateElement(el);

    if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
      setNativeValue(el, '');
      dispatchBeforeInput(el, 'deleteContentBackward', null);
      dispatchInput(el, 'deleteContentBackward', null);
      setNativeValue(el, text);
      dispatchBeforeInput(el, 'insertText', text);
      dispatchInput(el, 'insertText', text);
      el.dispatchEvent(new Event('change', { bubbles: true }));
    } else {
      selectElementContents(el);

      let inserted = false;
      try {
        if (document.execCommand) {
          document.execCommand('selectAll', false, null);
          dispatchBeforeInput(el, 'deleteContentBackward', null);
          document.execCommand('delete', false, null);
          dispatchBeforeInput(el, 'insertText', text);
          inserted = document.execCommand('insertText', false, text);
        }
      } catch (err) {
        inserted = false;
      }

      if (!inserted || getElementText(el).trim() !== String(text).trim()) {
        setEditableFallback(el, text);
      }

      setSelectionToEnd(el);
      dispatchInput(el, 'insertText', text);
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }

    await sleep(options.afterInputDelay ?? 400);
  }

  function findInputField(selectors, options = {}) {
    const candidates = [];
    const seen = new Set();

    for (const selector of selectors) {
      for (const el of document.querySelectorAll(selector)) {
        if (seen.has(el)) continue;
        seen.add(el);
        candidates.push(el);
      }
    }

    let best = null;
    let bestScore = -Infinity;

    for (const el of candidates) {
      if (!isVisible(el) || isDisabled(el)) continue;

      const label = getNodeLabel(el).toLowerCase();
      const rect = el.getBoundingClientRect?.();
      let score = 0;

      if (el.tagName === 'TEXTAREA') score += 10;
      const contentEditable = el.getAttribute?.('contenteditable');
      if (el.isContentEditable || (contentEditable && contentEditable !== 'false')) score += 10;
      if (el.getAttribute?.('role') === 'textbox') score += 10;
      if (/prompt|message|ask|type|chat|claude|gemini|输入|消息/.test(label)) score += 20;
      if (options.preferBottom && rect) score += Math.max(0, rect.top / Math.max(window.innerHeight, 1)) * 10;

      if (score > bestScore) {
        best = el;
        bestScore = score;
      }
    }

    return best;
  }

  function getSearchRoots(inputEl) {
    const roots = [];
    const seen = new Set();
    const selectors = [
      'form',
      'fieldset',
      '[role="form"]',
      '[data-testid*="composer" i]',
      '[class*="composer" i]',
      '[class*="input" i]'
    ];

    for (const selector of selectors) {
      const root = inputEl?.closest?.(selector);
      if (root && !seen.has(root)) {
        roots.push(root);
        seen.add(root);
      }
    }

    roots.push(document);
    return roots;
  }

  function normalizeButton(el) {
    if (!el) return null;
    return el.matches?.('button, [role="button"], a[aria-label*="发送"], a[aria-label*="Send"], a[aria-label*="send"], a[class*="send-btn"]')
      ? el
      : el.closest?.('button, [role="button"], a[aria-label*="发送"], a[aria-label*="Send"], a[aria-label*="send"], a[class*="send-btn"]');
  }

  function scoreSubmitButton(btn, inputEl, positivePattern, negativePattern, allowUnlabeledNearInput = false) {
    if (!btn || !isVisible(btn)) return -Infinity;

    const label = getNodeLabel(btn).toLowerCase();
    const positive = positivePattern || /(send|submit|run|发送|提交)/i;
    const negative = negativePattern || /(stop|cancel|voice|mic|microphone|upload|attach|image|file|menu|settings|stop generating|停止|取消|上传|附件|麦克风)/i;
    const hasPositiveSignal = positive.test(label) || btn.type === 'submit';

    let score = 0;

    if (!hasPositiveSignal && !allowUnlabeledNearInput) return -Infinity;

    if (positive.test(label)) score += 70;
    if (btn.type === 'submit') score += 30;
    if (/send|submit|run/.test(label)) score += 20;
    if (negative.test(label) && !positive.test(label)) score -= 80;
    if (!isDisabled(btn)) score += 15;
    if (isDisabled(btn)) score -= 30;

    const btnRect = btn.getBoundingClientRect?.();
    const inputRect = inputEl?.getBoundingClientRect?.();
    if (btnRect && inputRect) {
      const verticalDistance = Math.abs((btnRect.top + btnRect.bottom) / 2 - (inputRect.top + inputRect.bottom) / 2);
      const horizontalAfterInput = btnRect.left >= inputRect.left - 20;
      score += Math.max(0, 40 - verticalDistance / 4);
      if (horizontalAfterInput) score += 10;
      if (btnRect.bottom > window.innerHeight - 220) score += 10;
    }

    return score;
  }

  function findSubmitButton(options = {}) {
    const {
      inputEl,
      selectors = [],
      positivePattern,
      negativePattern,
      requireEnabled = false
    } = options;

    const candidates = [];
    const seen = new Set();

    for (const root of getSearchRoots(inputEl)) {
      for (const selector of selectors) {
        for (const raw of root.querySelectorAll(selector)) {
          const btn = normalizeButton(raw);
          if (!btn || seen.has(btn)) continue;
          seen.add(btn);
          candidates.push(btn);
        }
      }
      for (const raw of root.querySelectorAll('button, [role="button"], a[aria-label*="发送"], a[aria-label*="Send"], a[aria-label*="send"], a[class*="send-btn"]')) {
        const btn = normalizeButton(raw);
        if (!btn || seen.has(btn)) continue;
        seen.add(btn);
        candidates.push(btn);
      }
    }

    let best = null;
    let bestScore = -Infinity;

    for (const btn of candidates) {
      if (requireEnabled && isDisabled(btn)) continue;
      const score = scoreSubmitButton(
        btn,
        inputEl,
        positivePattern,
        negativePattern,
        options.allowUnlabeledNearInput
      );
      if (score > bestScore) {
        best = btn;
        bestScore = score;
      }
    }

    return bestScore >= 15 ? best : null;
  }

  async function waitForSubmitButton(options = {}, maxWait = 6000) {
    const start = Date.now();
    let lastButton = null;

    while (Date.now() - start < maxWait) {
      const button = findSubmitButton({ ...options, requireEnabled: false });
      if (button) lastButton = button;

      const enabledButton = findSubmitButton({ ...options, requireEnabled: true });
      if (enabledButton && !isDisabled(enabledButton)) return enabledButton;

      await sleep(100);
    }

    return lastButton && !isDisabled(lastButton) ? lastButton : null;
  }

  function clickElement(el) {
    const eventOptions = { bubbles: true, cancelable: true, view: window };
    try {
      el.dispatchEvent(new PointerEvent('pointerdown', eventOptions));
      el.dispatchEvent(new MouseEvent('mousedown', eventOptions));
      el.dispatchEvent(new PointerEvent('pointerup', eventOptions));
      el.dispatchEvent(new MouseEvent('mouseup', eventOptions));
    } catch (err) {
      // PointerEvent is not available in every execution context.
      el.dispatchEvent(new MouseEvent('mousedown', eventOptions));
      el.dispatchEvent(new MouseEvent('mouseup', eventOptions));
    }
    el.click();
  }

  function pressEnter(el) {
    el.focus();
    for (const type of ['keydown', 'keypress', 'keyup']) {
      el.dispatchEvent(new KeyboardEvent(type, {
        key: 'Enter',
        code: 'Enter',
        keyCode: 13,
        which: 13,
        bubbles: true,
        cancelable: true
      }));
    }
  }

  async function submitMessage(inputEl, options = {}) {
    const beforeText = getElementText(inputEl).trim();
    const button = await waitForSubmitButton(options, options.maxWait ?? 6000);

    if (button) {
      // Ensure input has focus before submitting (needed by some React apps)
      inputEl.focus();

      clickElement(button);
      await sleep(options.afterClickDelay ?? 700);

      const remainingText = getElementText(inputEl).trim();
      if (options.enterFallback !== false && beforeText && remainingText === beforeText) {
        pressEnter(inputEl);
        await sleep(options.afterEnterDelay ?? 500);

          // Try fast verification; if it fails, retry click + enter once more
        try {
          await verifySubmissionStarted(inputEl, beforeText, options, button);
          return { method: 'button+enter-fallback' };
        } catch (firstErr) {
          // Retry: click button again, then press Enter
          clickElement(button);
          await sleep(options.afterClickDelay ?? 700);
          pressEnter(inputEl);
          await sleep(options.afterEnterDelay ?? 500);
          await verifySubmissionStarted(inputEl, beforeText, options, button);
          return { method: 'button+enter-retry' };
        }
      }

      await verifySubmissionStarted(inputEl, beforeText, options, button);
      return { method: 'button' };
    }

    if (options.enterFallback !== false) {
      pressEnter(inputEl);
      await sleep(options.afterEnterDelay ?? 500);
      await verifySubmissionStarted(inputEl, beforeText, options, null);
      return { method: 'enter' };
    }

    throw new Error('Could not find enabled send button');
  }

  async function verifySubmissionStarted(inputEl, beforeText, options = {}, button = null) {
    if (options.verifySubmitted === false || !beforeText) return true;

    const start = Date.now();
    const maxWait = options.verifyMaxWait ?? 2500;
    while (Date.now() - start < maxWait) {
      // Priority 1: check for submitting indicators (stop button, etc.)
      // This is the strongest signal - the website has started processing
      if (options.submittingSelectors?.some(selector => document.querySelector(selector))) {
        return true;
      }

      // Priority 2: the clicked send button became disabled or was removed
      // from the DOM — the click registered even when the site's editor keeps
      // the input text populated (e.g. Gemini keeps a hidden textarea filled).
      if (button && (!document.contains(button) || isDisabled(button))) return true;

      // Priority 3: check if input text was cleared (common for textarea inputs)
      const currentText = getElementText(inputEl).trim();
      if (!currentText || currentText !== beforeText) return true;

      if (!document.contains(inputEl)) return true;
      await sleep(100);
    }

    throw new Error('Submit did not start: input text remained unchanged after click/Enter');
  }


  // ===== DOM → Markdown 序列化 =====
  // innerText 会吞掉块级结构: 表格后直接贴标题、标题后直接贴正文序号、
  // 代码块 UI 标签("bash 复制")混入、行内引用锚点只剩裸域名(github.com)。
  // 因此改用按节点遍历的序列化, 逐类生成 Markdown, 保证段落/标题/代码/表格
  // 各有正确分隔与语义。
  const BLOCK_TAGS = new Set([
    'P', 'DIV', 'SECTION', 'ARTICLE', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
    'LI', 'UL', 'OL', 'PRE', 'BLOCKQUOTE', 'TABLE', 'THEAD', 'TBODY',
    'TR', 'TH', 'TD', 'HR', 'DETAILS', 'SUMMARY', 'FIGURE', 'FIGCAPTION'
  ]);
  const SKIP_TEXT = /^(bash|代码|预览|复制|mermaid|Copy|code)$/i;

  // 行内序列化: 保留链接与代码, 剥离纯 UI 标签
  function serializeInline(node) {
    let out = '';
    const kids = node.childNodes || [];
    for (const child of kids) {
      if (child.nodeType === 3) { // Node.TEXT_NODE
        out += child.nodeValue;
        continue;
      }
      if (child.nodeType !== 1) continue; // Node.ELEMENT_NODE
      const tag = child.tagName;
      // SVG 渲染树(mermaid 预览等)不进正文: 其内部 <text> 是图形标签非正文
      if (tag === 'svg' || tag === 'SVG' || (child.namespaceURI || '').includes('svg')) continue;
      const cls = (child.className && child.className.baseVal !== undefined
        ? child.className.baseVal : child.className) || '';
      // 代码块的 UI 控件(语言标签/复制按钮/顶栏) 不进正文
      if (/\btop(-outer)?\b|\blanguage\b|copy-btn|复制/.test(String(cls))) continue;
      // chatglm 引用角标: <span class="source-item" data-url="https://...">github.com</span>
      // 按用户要求输出为 [域名](链接), 而不是裸域名
      if (child.getAttribute) {
        const dataUrl = child.getAttribute('data-url');
        if (dataUrl && /source-item|\bcitation\b|\bref\b/.test(String(cls) + ' ' + String(child.parentElement?.className || ''))) {
          const nameEl = child.querySelector('.source-item-num-name');
          const name = ((nameEl ? nameEl.innerText : child.innerText) || '').trim() || '来源';
          out += '[' + name + '](' + dataUrl + ')';
          continue;
        }
      }
      if (tag === 'A' && child.getAttribute('href')) {
        let t = (child.innerText || '').trim();
        let href = child.getAttribute('href');
        // deepseek 数字角标 <a href=来源><span class="ds-markdown-cite">-4-</span></a>
        // 去掉包围的破折号, 输出 [4](来源)
        if (/^[-–—\s]*\d+[-–—\s]*$/.test(t)) t = t.replace(/[-–—\s]/g, '');
        // 坏 href 防御(kimi 的 markdown 解析 bug 会把 ** / 空格 / [..] 塞进
        // href): URL 不应含裸空格, 超长也视为损坏 —— 丢弃整个引用(该 a 是
        // 空锚, 丢弃无正文损失), 避免整段英文源码混进正文
        if (/\s/.test(href) || href.length > 300) { out += t || ''; continue; }
        // kimi 空锚角标: 文本为空但有 data-site-name(如 "Github"/"exa.ai"),
        // 兜底再从 href 提取域名 —— 统一输出 [来源名](链接)
        if (!t) {
          t = (child.getAttribute('data-site-name') || '').trim();
          if (!t) {
            try { t = new URL(href, location.href).hostname.replace(/^www\./, ''); } catch (e) { /* keep empty */ }
          }
        }
        // 行内引用锚点: 保留为链接 Markdown
        out += t ? '[' + t + '](' + href + ')' : href;
        continue;
      }
      if (tag === 'CODE' || tag === 'KBD' || tag === 'SAMP') {
        out += '`' + (child.innerText || '') + '`';
        continue;
      }
      if (tag === 'BR') { out += '\n'; continue; }
      if (tag === 'STRONG' || tag === 'B') { out += '**' + serializeInline(child) + '**'; continue; }
      if (tag === 'EM' || tag === 'I') { out += '*' + serializeInline(child) + '*'; continue; }
      if (BLOCK_TAGS.has(tag)) { out += serializeInline(child); continue; }
      out += serializeInline(child);
    }
    // 叶子兜底: 无子节点的元素(真实 DOM 的 <b>x</b> 文本已在上面收集; 测试
    // fake DOM 的叶子文本存在自身)从 textContent/innerText 取
    if (!out.trim() && kids.length === 0) {
      out = (node.textContent || node.innerText || '');
    }
    return out;
  }

  // 表格 → Markdown 管道表
  function serializeTable(table) {
    const rows = [];
    table.querySelectorAll('tr').forEach(tr => {
      const cells = [];
      tr.querySelectorAll('th, td').forEach(c => {
        cells.push((c.innerText || '').trim().replace(/\s+/g, ' '));
      });
      if (cells.length) rows.push(cells);
    });
    if (!rows.length) return '';
    const width = Math.max(...rows.map(r => r.length));
    const lines = rows.map((cells, i) => {
      const pad = cells.concat(Array(Math.max(0, width - cells.length)).fill(''));
      const line = '| ' + pad.join(' | ') + ' |';
      return i === 0 ? line + '\n|' + Array(width).fill(' --- ').join('|') + '|' : line;
    });
    return lines.join('\n');
  }

  // 代码块: 只取代码本体, 丢弃 "bash 复制" 之类 UI 文本
  function serializeCodeBlock(el) {
    const cls = (el.className && el.className.baseVal !== undefined
      ? el.className.baseVal : el.className) || '';
    let lang = '';
    const langEl = el.querySelector('.language, [class*="language-"]');
    if (langEl) lang = (langEl.innerText || '').trim();
    else {
      const m = /language-(\w+)/.exec(String(cls));
      if (m) lang = m[1];
    }
    // 行号(qianwen 用 react-syntax-highlighter 的 .linenumber)是 UI 不进正文
    el.querySelectorAll('[class*="line-number"], [class*="linenumber"]')
      .forEach(n => n.remove());

    // 代码内容通常在 <code> 或 <pre> 内; 去掉顶栏(.top/.top-outer)。
    // mermaid 等渲染块可能没有 <code>, 回退 <pre> 再回退自身。
    const codeEl = el.querySelector('code') || el.querySelector('pre') || el;
    const code = (codeEl.innerText || '')
      .split('\n')
      // 「bash」「复制」「代码」「预览」「mermaid代码预览」等 UI 标签行
      .filter(l => !/^\s*\w*\s*(表格|复制|下载|代码预览|代码|预览)\s*$/.test(l) && !/^\s*(bash|copy|mermaid)\s*$/i.test(l))
      .join('\n')
      .trim();
    return '```' + lang + '\n' + code + '\n```';
  }

  // 块级序列化: 返回 Markdown 片段(不含尾部换行)
  function serializeBlock(el) {
    const tag = el.tagName;
    const cls = (el.className && el.className.baseVal !== undefined
      ? el.className.baseVal : el.className) || '';

    // SVG 渲染树(mermaid 预览等)不进正文: 图形 <text> 是画布标签非答复内容
    if (tag === 'SVG' || tag === 'svg' || (el.namespaceURI || '').includes('svg')) return '';

    if (/^H[1-6]$/.test(tag)) {
      const level = parseInt(tag.slice(1), 10);
      return '#'.repeat(level) + ' ' + serializeInline(el).trim();
    }
    if (tag === 'TABLE') return serializeTable(el);
    // 自定义表格容器(gemini .table-block-component 等): 内部找 <table> 复用
    // 表格序列化, 否则整块会被当普通容器拉平成一行
    if (/table-block|data-table|table-wrapper/.test(String(cls))) {
      const inner = el.querySelector('table');
      if (inner) return serializeTable(inner);
    }
    // 代码块判定: 只有 <pre> 或 class 明确是代码容器才当代码块。
    // 不能仅凭「内部含 <code>」判断——正文容器里也嵌着代码块, 那样会把
    // 整个正文误判成代码(实测只剩 ```bash ... ``` 三行)。
    if (tag === 'PRE' || /code-no-artifacts|language-|highlight|code-block|md-code/.test(String(cls))) {
      return serializeCodeBlock(el);
    }
    if (tag === 'LI') {
      // 块级 li(嵌段落/代码块, 如 deepseek「安装命令：bash复制下载dsh plugin…」):
      // 首行 "- ", 后续块缩进两格; 纯文本 li 仍走行内
      const liBlockKids = Array.from(el.children).filter(c => BLOCK_TAGS.has(c.tagName));
      if (liBlockKids.length > 0) {
        return '- ' + serializeChildren(el).replace(/\n/g, '\n  ');
      }
      return '- ' + serializeInline(el).trim();
    }
    if (tag === 'BLOCKQUOTE') {
      return serializeInline(el).trim().split('\n').map(l => '> ' + l).join('\n');
    }
    if (tag === 'HR') return '---';
    if (tag === 'DETAILS') {
      const sum = el.querySelector('summary');
      const head = sum ? '**' + serializeInline(sum).trim() + '**' : '';
      const rest = [];
      for (const child of el.children) {
        if (child === sum) continue;
        const t = serializeBlock(child).trim();
        if (t) rest.push(t);
      }
      return head + (rest.length ? '\n\n' + rest.join('\n\n') : '');
    }
    // 普通块: 若内部还有块级子节点则递归, 否则按行内文本处理
    const blockChildren = Array.from(el.children).filter(c => BLOCK_TAGS.has(c.tagName));
    if (blockChildren.length > 0) {
      return serializeChildren(el);
    }
    const text = serializeInline(el).trim();
    return text;
  }

  // 行内标签: 与相邻内容属同一句, 序列化后用空格连接而非换行
  const INLINE_TAGS = new Set(['STRONG', 'B', 'EM', 'I', 'CODE', 'KBD', 'SAMP', 'A',
    'SPAN', 'SUP', 'SUB', 'MARK', 'SMALL', 'U', 'S', 'DEL', 'INS', 'BR', 'IMG']);

  function serializeChildren(parent) {
    // parts: { text, inline } — inline=来自行内元素或裸文本(与相邻同句)
    const parts = [];
    // 按 childNodes 顺序遍历: 裸文本节点也要收集 —— kimi 的段落是
    // <div class="paragraph">[TEXT <strong> TEXT <code> TEXT <div 引用容器>]</div>,
    // 只遍历 children(元素)会把 160 字句里 140+ 字的裸文本全丢(实测只剩
    // 「核心能力：\n\nread_page」)
    let textBuf = '';
    const flushText = () => {
      const t = textBuf.replace(/\s+/g, ' ').trim();
      if (t) parts.push({ text: t, inline: true });
      textBuf = '';
    };
    for (const child of parent.childNodes) {
      if (child.nodeType === 3) { textBuf += child.nodeValue || ''; continue; } // TEXT_NODE
      if (child.nodeType !== 1) continue; // ELEMENT_NODE
      flushText();
      const t = serializeBlock(child).trim();
      if (t) parts.push({ text: t, inline: INLINE_TAGS.has(child.tagName) });
    }
    flushText();
    // 拼接: 行内+行内 → 空格连成一句; 列表项 → 单换行; 块级 → 空行
    let out = '';
    for (let i = 0; i < parts.length; i++) {
      const prev = parts[i - 1];
      const cur = parts[i];
      const prevIsItem = prev && prev.text.startsWith('- ');
      const curIsItem = cur.text.startsWith('- ');
      if (i === 0) out = cur.text;
      else if (prevIsItem && curIsItem) out += '\n' + cur.text;
      else if (prev.inline && cur.inline) out += ' ' + cur.text;
      else out += '\n\n' + cur.text;
    }
    return out;
  }

  // 入口: 把容器序列化为 Markdown(先克隆, 避免改页面)
  function toMarkdown(element) {
    if (!element) return '';
    const clone = element.cloneNode(true);
    // 注入样式与脚本永不进正文
    clone.querySelectorAll('style, script').forEach(el => el.remove());
    const md = serializeBlock(clone).trim();
    // 压缩 3+ 连续空行, 去掉行尾空格
    return md.replace(/\n{3,}/g, '\n\n').split('\n').map(l => l.replace(/\s+$/, '')).join('\n');
  }

  window.AIPanelDom = {
    findInputField,
    setEditorText,
    submitMessage,
    findSubmitButton,
    waitForSubmitButton,
    isVisible,
    isDisabled,
    getElementText,
    getNodeLabel,
    toMarkdown,
    serializeTable,
    serializeInline,
    _test: {
      scoreSubmitButton,
      dispatchInput,
      verifySubmissionStarted
    }
  };
})();
