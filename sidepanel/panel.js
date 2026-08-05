// AI Panel - Side Panel Controller

const AI_TYPES = ['claude', 'chatgpt', 'gemini', 'deepseek', 'glm', 'kimi', 'grok', 'qianwen', 'mimo', 'minimax', 'doubao', 'hunyuan'];

// Display name mapping for all AI models
const AI_DISPLAY_NAMES = {
  claude: 'Claude',
  chatgpt: 'ChatGPT',
  grok: 'Grok',
  gemini: 'Gemini',
  deepseek: '深度求索',
  glm: '智谱',
  kimi: '月之暗面',
  qianwen: '通义千问',
  mimo: 'MiMo',
  minimax: 'Minimax',
  hunyuan: '混元',
  doubao: '豆包'
};

function getAIName(aiType) {
  return AI_DISPLAY_NAMES[aiType] || capitalize(aiType);
}

// Cross-reference action keywords (inserted into message)
const CROSS_REF_ACTIONS = {
  evaluate: { prompt: '评价一下' },
  learn: { prompt: '有什么值得借鉴的' },
  critique: { prompt: '批评一下，指出问题' },
  supplement: { prompt: '有什么遗漏需要补充' },
  compare: { prompt: '对比一下你的观点' }
};

// DOM Elements
const messageInput = document.getElementById('message-input');
const sendBtn = document.getElementById('send-btn');
const logContainer = document.getElementById('log-container');
const fileInput = document.getElementById('file-input');
const addFileBtn = document.getElementById('add-file-btn');
const fileList = document.getElementById('file-list');

// Selected files storage
let selectedFiles = [];

// Track connected tabs
const connectedTabs = {
  claude: null,
  chatgpt: null,
  gemini: null,
  deepseek: null,
  glm: null,
  kimi: null,
  grok: null,
  qianwen: null,
  mimo: null,
  minimax: null,
  doubao: null,
  hunyuan: null
};

// Discussion Mode State
let discussionState = {
  active: false,
  topic: '',
  participants: [],  // [ai1, ai2]
  currentRound: 0,
  history: [],  // [{round, ai, type: 'initial'|'evaluation'|'response', content}]
  pendingResponses: new Set(),  // AIs we're waiting for
  roundType: null  // 'initial', 'cross-eval', 'counter'
};


// Initialize
document.addEventListener('DOMContentLoaded', () => {
  checkConnectedTabs();
  setupEventListeners();
  setupDiscussionMode();
  setupPersonaDebateMode();
  setupFileUpload();
  setupLogToggle();
});

function setupEventListeners() {
  sendBtn.addEventListener('click', handleSend);

  // Enter to send, Shift+Enter for new line (like ChatGPT)
  // But ignore Enter during IME composition (e.g., Chinese input)
  messageInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      handleSend();
    }
  });

  // Shortcut buttons (/cross, <-)
  document.querySelectorAll('.shortcut-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const insertText = btn.dataset.insert;
      const cursorPos = messageInput.selectionStart;
      const textBefore = messageInput.value.substring(0, cursorPos);
      const textAfter = messageInput.value.substring(cursorPos);

      messageInput.value = textBefore + insertText + textAfter;
      messageInput.focus();
      messageInput.selectionStart = messageInput.selectionEnd = cursorPos + insertText.length;
    });
  });

  // Action select - insert action prompt into textarea
  document.getElementById('action-select').addEventListener('change', (e) => {
    const action = e.target.value;
    if (!action) return;

    const actionConfig = CROSS_REF_ACTIONS[action];
    if (actionConfig) {
      const cursorPos = messageInput.selectionStart;
      const textBefore = messageInput.value.substring(0, cursorPos);
      const textAfter = messageInput.value.substring(cursorPos);

      // Add space before if needed
      const needsSpace = textBefore.length > 0 && !textBefore.endsWith(' ') && !textBefore.endsWith('\n');
      const insertText = (needsSpace ? ' ' : '') + actionConfig.prompt + ' ';

      messageInput.value = textBefore + insertText + textAfter;
      messageInput.focus();
      messageInput.selectionStart = messageInput.selectionEnd = cursorPos + insertText.length;
    }

    // Reset select to placeholder
    e.target.value = '';
  });

  // Mention buttons - insert @AI into textarea
  document.querySelectorAll('.mention-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const mention = btn.dataset.mention;
      const cursorPos = messageInput.selectionStart;
      const textBefore = messageInput.value.substring(0, cursorPos);
      const textAfter = messageInput.value.substring(cursorPos);

      // Add space before if needed
      const needsSpace = textBefore.length > 0 && !textBefore.endsWith(' ') && !textBefore.endsWith('\n');
      const insertText = (needsSpace ? ' ' : '') + mention + ' ';

      messageInput.value = textBefore + insertText + textAfter;
      messageInput.focus();
      messageInput.selectionStart = messageInput.selectionEnd = cursorPos + insertText.length;
    });
  });

  // Listen for messages from background script
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'TAB_STATUS_UPDATE') {
      updateTabStatus(message.aiType, message.connected);
    } else if (message.type === 'RESPONSE_CAPTURED') {
      if (message.error) {
        log(`${message.aiType}: ${message.error}`, 'error');
      } else {
        log(`${message.aiType}: Response captured`, 'success');
      }
      // Handle discussion mode response (guard: skip if persona debate is active AND no error)
      if (!message.error && discussionState.active && !personaDebateState.active
          && discussionState.pendingResponses.has(message.aiType)) {
        handleDiscussionResponse(message.aiType, message.content);
      }
      // Persona debate responses are handled by sendAndWait's independent listener
    } else if (message.type === 'SEND_RESULT') {
      if (message.success) {
        log(`${message.aiType}: Message sent`, 'success');
      } else {
        log(`${message.aiType}: Failed - ${message.error}`, 'error');
      }
    }
  });
}

async function checkConnectedTabs() {
  try {
    const tabs = await chrome.tabs.query({});

    for (const tab of tabs) {
      const aiType = getAITypeFromUrl(tab.url);
      if (aiType) {
        connectedTabs[aiType] = tab.id;
        updateTabStatus(aiType, true);
      }
    }
  } catch (err) {
    log('Error checking tabs: ' + err.message, 'error');
  }
}

function getAITypeFromUrl(url) {
  if (!url) return null;
  if (url.includes('claude.ai')) return 'claude';
  if (url.includes('chat.openai.com') || url.includes('chatgpt.com')) return 'chatgpt';
  if (url.includes('gemini.google.com')) return 'gemini';
  if (url.includes('chat.deepseek.com')) return 'deepseek';
  if (url.includes('chatglm.cn') || url.includes('z.ai')) return 'glm';
  if (url.includes('kimi.com')) return 'kimi';
  if (url.includes('grok.com')) return 'grok';
  if (url.includes('qianwen.com') || url.includes('tongyi.aliyun.com')) return 'qianwen';
  if (url.includes('xiaomimimo.com')) return 'mimo';
  if (url.includes('minimaxi.com') || url.includes('minimax.io')) return 'minimax';
  if (url.includes('doubao.com')) return 'doubao';
  if (url.includes('yuanbao.tencent.com')) return 'hunyuan';
  return null;
}

function updateTabStatus(aiType, connected) {
  // Normal mode status dot
  const statusEl = document.getElementById(`status-${aiType}`);
  if (statusEl) {
    statusEl.className = 'status ' + (connected ? 'connected' : 'disconnected');
    statusEl.title = connected ? '已连接' : '未找到';
  }
  // Discussion mode status dot
  const discStatusEl = document.getElementById(`status-${aiType}-disc`);
  if (discStatusEl) {
    discStatusEl.className = 'status ' + (connected ? 'connected' : 'disconnected');
    discStatusEl.title = connected ? '已连接' : '未找到';
  }
  if (connected) {
    connectedTabs[aiType] = true;
  }
}

async function handleSend() {
  const message = messageInput.value.trim();
  if (!message) return;

  // Parse message for @ mentions
  const parsed = parseMessage(message);

  // Determine targets
  let targets;
  if (parsed.mentions.length > 0) {
    // If @ mentioned specific AIs, only send to those
    targets = parsed.mentions;
  } else {
    // Otherwise use checkbox selection
    targets = AI_TYPES.filter(ai => {
      const checkbox = document.getElementById(`target-${ai}`);
      return checkbox && checkbox.checked;
    });
  }

  if (targets.length === 0) {
    log('No targets selected', 'error');
    return;
  }

  sendBtn.disabled = true;

  // Clear input immediately after sending
  messageInput.value = '';

  // Send files first if any
  const filesToSend = [...selectedFiles];
  if (filesToSend.length > 0) {
    log(`正在上传 ${filesToSend.length} 个文件...`);
    for (const target of targets) {
      await sendFilesToAI(target, filesToSend);
    }
    clearFiles();
    // Wait a bit for files to be processed before sending message
    await new Promise(r => setTimeout(r, 500));
  }

  try {
    // If mutual review, handle specially
    if (parsed.mutual) {
      if (targets.length < 2) {
        log('Mutual review requires at least 2 AIs selected', 'error');
      } else {
        log(`Mutual review: ${targets.join(', ')}`);
        await handleMutualReview(targets, parsed.prompt);
      }
    }
    // If cross-reference, handle specially
    else if (parsed.crossRef) {
      log(`Cross-reference: ${parsed.targetAIs.join(', ')} <- ${parsed.sourceAIs.join(', ')}`);
      await handleCrossReference(parsed);
    } else {
      // Send to target(s)
      log(`Sending to: ${targets.join(', ')}`);
      for (const target of targets) {
        await sendToAI(target, message);
      }
    }
  } catch (err) {
    log('Error: ' + err.message, 'error');
  }

  sendBtn.disabled = false;
  messageInput.focus();
}

function parseMessage(message) {
  // Check for /mutual command: /mutual [optional prompt]
  // Triggers mutual review based on current responses (no new topic needed)
  const trimmedMessage = message.trim();
  if (trimmedMessage.toLowerCase() === '/mutual' || trimmedMessage.toLowerCase().startsWith('/mutual ')) {
    // Extract everything after "/mutual " as the prompt
    const prompt = trimmedMessage.length > 7 ? trimmedMessage.substring(7).trim() : '';
    return {
      mutual: true,
      prompt: prompt || '请评价以上观点。你同意什么？不同意什么？有什么补充？',
      crossRef: false,
      mentions: [],
      originalMessage: message
    };
  }

  // Check for /cross command first: /cross @targets <- @sources message
  // Use this for complex cases (3 AIs, or when you want to be explicit)
  if (message.trim().toLowerCase().startsWith('/cross ')) {
    const arrowIndex = message.indexOf('<-');
    if (arrowIndex === -1) {
      // No arrow found, treat as regular message
      return { crossRef: false, mentions: [], originalMessage: message };
    }

    const beforeArrow = message.substring(7, arrowIndex).trim(); // Skip "/cross "
    const afterArrow = message.substring(arrowIndex + 2).trim();  // Skip "<-"

    // Extract targets (before arrow)
    const mentionPattern = /@(claude|chatgpt|grok|gemini|deepseek|glm|kimi|qianwen|mimo|minimax|hunyuan|doubao)/gi;
    const targetMatches = [...beforeArrow.matchAll(mentionPattern)];
    const targetAIs = [...new Set(targetMatches.map(m => m[1].toLowerCase()))];

    // Extract sources and message (after arrow)
    // Find all @mentions in afterArrow, sources are all @mentions
    // Message is everything after the last @mention
    const sourceMatches = [...afterArrow.matchAll(mentionPattern)];
    const sourceAIs = [...new Set(sourceMatches.map(m => m[1].toLowerCase()))];

    // Find where the actual message starts (after the last @mention)
    let actualMessage = afterArrow;
    if (sourceMatches.length > 0) {
      const lastMatch = sourceMatches[sourceMatches.length - 1];
      const lastMentionEnd = lastMatch.index + lastMatch[0].length;
      actualMessage = afterArrow.substring(lastMentionEnd).trim();
    }

    if (targetAIs.length > 0 && sourceAIs.length > 0) {
      return {
        crossRef: true,
        mentions: [...targetAIs, ...sourceAIs],
        targetAIs,
        sourceAIs,
        originalMessage: actualMessage
      };
    }
  }

  // Pattern-based detection for @ mentions
  const mentionPattern = /@(claude|chatgpt|grok|gemini|deepseek|glm|kimi|qianwen|mimo|minimax|hunyuan|doubao)/gi;
  const matches = [...message.matchAll(mentionPattern)];
  const mentions = [...new Set(matches.map(m => m[1].toLowerCase()))];

  // For exactly 2 AIs: use keyword detection (simpler syntax)
  // Last mentioned = source (being evaluated), first = target (doing evaluation)
  if (mentions.length === 2) {
    const evalKeywords = /评价|看看|怎么样|怎么看|如何|讲的|说的|回答|赞同|同意|分析|认为|观点|看法|意见|借鉴|批评|补充|对比|evaluate|think of|opinion|review|agree|analysis|compare|learn from/i;

    if (evalKeywords.test(message)) {
      const sourceAI = matches[matches.length - 1][1].toLowerCase();
      const targetAI = matches[0][1].toLowerCase();

      return {
        crossRef: true,
        mentions,
        targetAIs: [targetAI],
        sourceAIs: [sourceAI],
        originalMessage: message
      };
    }
  }

  // For 3+ AIs without /cross command: just send to all (no cross-reference)
  // User should use /cross command for complex 3-AI scenarios
  return {
    crossRef: false,
    mentions,
    originalMessage: message
  };
}

async function handleCrossReference(parsed) {
  // Get responses from all source AIs
  const sourceResponses = [];

  for (const sourceAI of parsed.sourceAIs) {
    const response = await getLatestResponse(sourceAI);
    if (!response) {
      log(`Could not get ${sourceAI}'s response`, 'error');
      return;
    }
    sourceResponses.push({ ai: sourceAI, content: response });
  }

  // Build the full message with XML tags for each source
  let fullMessage = parsed.originalMessage + '\n';

  for (const source of sourceResponses) {
    fullMessage += `
<${source.ai}_response>
${source.content}
</${source.ai}_response>`;
  }

  // Send to all target AIs
  for (const targetAI of parsed.targetAIs) {
    await sendToAI(targetAI, fullMessage);
  }
}

// ============================================
// Mutual Review Functions
// ============================================

async function handleMutualReview(participants, prompt) {
  // Get current responses from all participants
  const responses = {};

  log(`[Mutual] Fetching responses from ${participants.join(', ')}...`);

  for (const ai of participants) {
    const response = await getLatestResponse(ai);
    if (!response || response.trim().length === 0) {
      log(`[Mutual] Could not get ${ai}'s response - make sure ${ai} has replied first`, 'error');
      return;
    }
    responses[ai] = response;
    log(`[Mutual] Got ${ai}'s response (${response.length} chars)`);
  }

  log(`[Mutual] All responses collected. Sending cross-evaluations...`);

  // For each AI, send them the responses from all OTHER AIs
  for (const targetAI of participants) {
    const otherAIs = participants.filter(ai => ai !== targetAI);

    // Build message with all other AIs' responses
    let evalMessage = `以下是其他 AI 的观点：\n`;

    for (const sourceAI of otherAIs) {
      evalMessage += `
<${sourceAI}_response>
${responses[sourceAI]}
</${sourceAI}_response>
`;
    }

    evalMessage += `\n${prompt}`;

    log(`[Mutual] Sending to ${targetAI}: ${otherAIs.join('+')} responses + prompt`);
    await sendToAI(targetAI, evalMessage);
  }

  log(`[Mutual] Complete! All ${participants.length} AIs received cross-evaluations`, 'success');
}

async function getLatestResponse(aiType) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(
      { type: 'GET_RESPONSE', aiType },
      (response) => {
        resolve(response?.content || null);
      }
    );
  });
}

async function sendToAI(aiType, message) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(
      { type: 'SEND_MESSAGE', aiType, message },
      (response) => {
        if (response?.success) {
          log(`Sent to ${aiType}`, 'success');
        } else {
          log(`Failed to send to ${aiType}: ${response?.error || 'Unknown error'}`, 'error');
        }
        resolve(response);
      }
    );
  });
}

function log(message, type = 'info') {
  const entry = document.createElement('div');
  entry.className = 'log-entry' + (type !== 'info' ? ` ${type}` : '');

  const time = new Date().toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });

  entry.innerHTML = `<span class="time">${time}</span>${message}`;
  logContainer.insertBefore(entry, logContainer.firstChild);

  // Keep only last 50 entries
  while (logContainer.children.length > 50) {
    logContainer.removeChild(logContainer.lastChild);
  }
}

// Collapsible activity log — collapsed by default, click header to expand/collapse
function setupLogToggle() {
  const section = document.getElementById('log-section');
  const toggle = document.getElementById('log-toggle');
  if (!section || !toggle) return;

  toggle.addEventListener('click', () => {
    section.classList.toggle('log-collapsed');
    const expanded = !section.classList.contains('log-collapsed');
    toggle.setAttribute('aria-expanded', String(expanded));
  });
}

// ============================================
// Discussion Mode Functions
// ============================================

function setupDiscussionMode() {
  // Mode switcher buttons
  document.getElementById('mode-normal').addEventListener('click', () => switchMode('normal'));
  document.getElementById('mode-discussion').addEventListener('click', () => switchMode('discussion'));
  document.getElementById('mode-persona-debate').addEventListener('click', () => switchMode('persona-debate'));

  // Discussion controls
  document.getElementById('start-discussion-btn').addEventListener('click', startDiscussion);
  document.getElementById('next-round-btn').addEventListener('click', nextRound);
  document.getElementById('end-discussion-btn').addEventListener('click', endDiscussion);
  document.getElementById('generate-summary-btn').addEventListener('click', generateSummary);
  document.getElementById('new-discussion-btn').addEventListener('click', resetDiscussion);
  document.getElementById('interject-btn').addEventListener('click', handleInterject);

  // Participant selection validation
  document.querySelectorAll('input[name="participant"]').forEach(checkbox => {
    checkbox.addEventListener('change', validateParticipants);
  });
}

function switchMode(mode) {
  const modes = {
    'normal': { panel: 'normal-mode', btn: 'mode-normal' },
    'discussion': { panel: 'discussion-mode', btn: 'mode-discussion' },
    'persona-debate': { panel: 'persona-debate-mode', btn: 'mode-persona-debate' }
  };

  // Hide all mode panels and deactivate all buttons
  Object.values(modes).forEach(m => {
    document.getElementById(m.panel)?.classList.add('hidden');
    document.getElementById(m.btn)?.classList.remove('active');
  });

  // Show selected mode
  const target = modes[mode];
  if (target) {
    document.getElementById(target.panel)?.classList.remove('hidden');
    document.getElementById(target.btn)?.classList.add('active');
  }
}

function validateParticipants() {
  const selected = document.querySelectorAll('input[name="participant"]:checked');
  const startBtn = document.getElementById('start-discussion-btn');
  startBtn.disabled = selected.length !== 2;
}

async function startDiscussion() {
  const topic = document.getElementById('discussion-topic').value.trim();
  if (!topic) {
    log('请输入讨论主题', 'error');
    return;
  }

  const selected = Array.from(document.querySelectorAll('input[name="participant"]:checked'))
    .map(cb => cb.value);

  if (selected.length !== 2) {
    log('请选择 2 位参与者', 'error');
    return;
  }

  // Initialize discussion state
  discussionState = {
    active: true,
    topic: topic,
    participants: selected,
    currentRound: 1,
    history: [],
    pendingResponses: new Set(selected),
    roundType: 'initial'
  };

  // Update UI
  document.getElementById('discussion-setup').classList.add('hidden');
  document.getElementById('discussion-active').classList.remove('hidden');
  document.getElementById('round-badge').textContent = '第 1 轮';
  document.getElementById('participants-badge').textContent =
    `${getAIName(selected[0])} vs ${getAIName(selected[1])}`;
  document.getElementById('topic-display').textContent = topic;
  updateDiscussionStatus('waiting', `等待 ${selected.map(getAIName).join(' 和 ')} 的初始回复...`);

  // Disable buttons during round
  document.getElementById('next-round-btn').disabled = true;
  document.getElementById('generate-summary-btn').disabled = true;

  log(`讨论开始: ${selected.map(getAIName).join(' vs ')}`, 'success');

  // Auto-open split-screen dashboard
  publishDiscussionStatus();
  chrome.runtime.sendMessage({ type: 'OPEN_SPLITVIEW' });
  log('[分屏视图] 已自动打开');

  // Send topic to both AIs
  for (const ai of selected) {
    await sendToAI(ai, `Please share your thoughts on the following topic:\n\n${topic}`);
  }
}

function handleDiscussionResponse(aiType, content) {
  if (!discussionState.active) return;

  // Record this response in history
  discussionState.history.push({
    round: discussionState.currentRound,
    ai: aiType,
    type: discussionState.roundType,
    content: content
  });

  // Remove from pending
  discussionState.pendingResponses.delete(aiType);

  log(`讨论: ${getAIName(aiType)} 已回复 (第 ${discussionState.currentRound} 轮)`, 'success');

  // Publish status for split view
  publishDiscussionStatus();

  // Check if all pending responses received
  if (discussionState.pendingResponses.size === 0) {
    onRoundComplete();
  } else {
    const remaining = Array.from(discussionState.pendingResponses).map(getAIName).join(', ');
    updateDiscussionStatus('waiting', `等待 ${remaining}...`);
  }
}

function onRoundComplete() {
  log(`第 ${discussionState.currentRound} 轮完成`, 'success');
  updateDiscussionStatus('ready', `第 ${discussionState.currentRound} 轮完成，可以进入下一轮`);
  publishDiscussionStatus();

  // Enable next round button
  document.getElementById('next-round-btn').disabled = false;
  document.getElementById('generate-summary-btn').disabled = false;
}

async function nextRound() {
  discussionState.currentRound++;
  const [ai1, ai2] = discussionState.participants;

  // Update UI
  document.getElementById('round-badge').textContent = `第 ${discussionState.currentRound} 轮`;
  document.getElementById('next-round-btn').disabled = true;
  document.getElementById('generate-summary-btn').disabled = true;

  // Get previous round responses
  const prevRound = discussionState.currentRound - 1;
  const ai1Response = discussionState.history.find(
    h => h.round === prevRound && h.ai === ai1
  )?.content;
  const ai2Response = discussionState.history.find(
    h => h.round === prevRound && h.ai === ai2
  )?.content;

  if (!ai1Response || !ai2Response) {
    log('缺少上一轮的回复', 'error');
    return;
  }

  // Set pending responses
  discussionState.pendingResponses = new Set([ai1, ai2]);
  discussionState.roundType = 'cross-eval';

  updateDiscussionStatus('waiting', `交叉评价: ${getAIName(ai1)} 评价 ${getAIName(ai2)}，${getAIName(ai2)} 评价 ${getAIName(ai1)}...`);

  log(`第 ${discussionState.currentRound} 轮: 交叉评价开始`);
  publishDiscussionStatus();

  // Send cross-evaluation requests
  // AI1 evaluates AI2's response
  const msg1 = `Here is ${getAIName(ai2)}'s response to the topic "${discussionState.topic}":

<${ai2}_response>
${ai2Response}
</${ai2}_response>

Please evaluate this response. What do you agree with? What do you disagree with? What would you add or change?`;

  // AI2 evaluates AI1's response
  const msg2 = `Here is ${getAIName(ai1)}'s response to the topic "${discussionState.topic}":

<${ai1}_response>
${ai1Response}
</${ai1}_response>

Please evaluate this response. What do you agree with? What do you disagree with? What would you add or change?`;

  await sendToAI(ai1, msg1);
  await sendToAI(ai2, msg2);
}

async function handleInterject() {
  const input = document.getElementById('interject-input');
  const message = input.value.trim();

  if (!message) {
    log('请输入要发送的消息', 'error');
    return;
  }

  if (!discussionState.active || discussionState.participants.length === 0) {
    log('当前没有进行中的讨论', 'error');
    return;
  }

  const btn = document.getElementById('interject-btn');
  btn.disabled = true;

  const [ai1, ai2] = discussionState.participants;

  log(`[插话] 正在获取双方最新回复...`);

  // Get latest responses from both participants
  const ai1Response = await getLatestResponse(ai1);
  const ai2Response = await getLatestResponse(ai2);

  if (!ai1Response || !ai2Response) {
    log(`[插话] 无法获取回复，请确保双方都已回复`, 'error');
    btn.disabled = false;
    return;
  }

  log(`[插话] 已获取双方回复，正在发送...`);

  // Send to AI1: user message + AI2's response
  const msg1 = `${message}

以下是 ${getAIName(ai2)} 的最新回复：

<${ai2}_response>
${ai2Response}
</${ai2}_response>`;

  // Send to AI2: user message + AI1's response
  const msg2 = `${message}

以下是 ${getAIName(ai1)} 的最新回复：

<${ai1}_response>
${ai1Response}
</${ai1}_response>`;

  await sendToAI(ai1, msg1);
  await sendToAI(ai2, msg2);

  log(`[插话] 已发送给双方（含对方回复）`, 'success');

  // Clear input
  input.value = '';
  btn.disabled = false;
}

async function generateSummary() {
  document.getElementById('generate-summary-btn').disabled = true;
  updateDiscussionStatus('waiting', '正在请求双方生成总结...');

  const [ai1, ai2] = discussionState.participants;

  // Build conversation history for summary
  let historyText = `主题: ${discussionState.topic}\n\n`;

  for (let round = 1; round <= discussionState.currentRound; round++) {
    historyText += `=== 第 ${round} 轮 ===\n\n`;
    const roundEntries = discussionState.history.filter(h => h.round === round);
    for (const entry of roundEntries) {
      historyText += `[${getAIName(entry.ai)}]:\n${entry.content}\n\n`;
    }
  }

  const summaryPrompt = `请对以下 AI 之间的讨论进行总结。请包含：
1. 主要共识点
2. 主要分歧点
3. 各方的核心观点
4. 总体结论

讨论历史：
${historyText}`;

  // Send to both AIs
  discussionState.roundType = 'summary';
  discussionState.pendingResponses = new Set([ai1, ai2]);

  log(`[Summary] 正在请求双方生成总结...`);
  publishDiscussionStatus();
  await sendToAI(ai1, summaryPrompt);
  await sendToAI(ai2, summaryPrompt);

  // Wait for both responses, then show summary
  const checkForSummary = setInterval(async () => {
    if (discussionState.pendingResponses.size === 0) {
      clearInterval(checkForSummary);

      // Get both summaries
      const summaries = discussionState.history.filter(h => h.type === 'summary');
      const ai1Summary = summaries.find(s => s.ai === ai1)?.content || '';
      const ai2Summary = summaries.find(s => s.ai === ai2)?.content || '';

      log(`[Summary] 双方总结已生成`, 'success');
      showSummary(ai1Summary, ai2Summary);
    }
  }, 500);
}

function showSummary(ai1Summary, ai2Summary) {
  document.getElementById('discussion-active').classList.add('hidden');
  document.getElementById('discussion-summary').classList.remove('hidden');

  const [ai1, ai2] = discussionState.participants;

  // Handle empty summaries
  if (!ai1Summary && !ai2Summary) {
    log('警告: 未收到 AI 的总结内容', 'error');
  }

  // Build summary HTML - show both summaries side by side conceptually
  let html = `<div class="round-summary">
    <h4>双方总结对比</h4>
    <div class="summary-comparison">
      <div class="ai-response">
        <div class="ai-name ${ai1}">${getAIName(ai1)} 的总结：</div>
        <div>${escapeHtml(ai1Summary).replace(/\n/g, '<br>')}</div>
      </div>
      <div class="ai-response">
        <div class="ai-name ${ai2}">${getAIName(ai2)} 的总结：</div>
        <div>${escapeHtml(ai2Summary).replace(/\n/g, '<br>')}</div>
      </div>
    </div>
  </div>`;

  // Add round-by-round history
  html += `<div class="round-summary"><h4>完整讨论历史</h4>`;
  for (let round = 1; round <= discussionState.currentRound; round++) {
    const roundEntries = discussionState.history.filter(h => h.round === round && h.type !== 'summary');
    if (roundEntries.length > 0) {
      html += `<div style="margin-top:12px"><strong>第 ${round} 轮</strong></div>`;
      for (const entry of roundEntries) {
        const preview = entry.content.substring(0, 200) + (entry.content.length > 200 ? '...' : '');
        html += `<div class="ai-response">
          <div class="ai-name ${entry.ai}">${getAIName(entry.ai)}:</div>
          <div>${escapeHtml(preview).replace(/\n/g, '<br>')}</div>
        </div>`;
      }
    }
  }
  html += `</div>`;

  document.getElementById('summary-content').innerHTML = html;
  discussionState.active = false;
  publishDiscussionStatus();
  log('讨论总结已生成', 'success');
}

function endDiscussion() {
  if (confirm('确定结束讨论吗？建议先生成总结。')) {
    resetDiscussion();
  }
}

function resetDiscussion() {
  discussionState = {
    active: false,
    topic: '',
    participants: [],
    currentRound: 0,
    history: [],
    pendingResponses: new Set(),
    roundType: null
  };

  // Reset UI
  document.getElementById('discussion-setup').classList.remove('hidden');
  document.getElementById('discussion-active').classList.add('hidden');
  document.getElementById('discussion-summary').classList.add('hidden');
  document.getElementById('discussion-topic').value = '';
  document.getElementById('next-round-btn').disabled = true;
  document.getElementById('generate-summary-btn').disabled = true;

  publishDiscussionStatus();
  log('讨论已结束');
}

function updateDiscussionStatus(state, text) {
  const statusEl = document.getElementById('discussion-status');
  statusEl.textContent = text;
  statusEl.className = 'discussion-status ' + state;
}

function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ============================================
// File Upload Functions
// ============================================

function setupFileUpload() {
  addFileBtn.addEventListener('click', () => fileInput.click());

  fileInput.addEventListener('change', (e) => {
    const files = Array.from(e.target.files);
    files.forEach(file => addFile(file));
    fileInput.value = ''; // Reset for next selection
  });
}

function addFile(file) {
  // Check file size (max 10MB)
  if (file.size > 10 * 1024 * 1024) {
    log(`文件 ${file.name} 超过 10MB 限制`, 'error');
    return;
  }

  // Check for duplicates
  if (selectedFiles.some(f => f.name === file.name && f.size === file.size)) {
    return;
  }

  selectedFiles.push(file);
  renderFileList();
}

function removeFile(index) {
  selectedFiles.splice(index, 1);
  renderFileList();
}

function renderFileList() {
  fileList.innerHTML = '';

  selectedFiles.forEach((file, index) => {
    const item = document.createElement('div');
    item.className = 'file-item';
    item.innerHTML = `
      <span class="file-name" title="${file.name}">${file.name}</span>
      <button class="remove-file" title="移除">&times;</button>
    `;
    item.querySelector('.remove-file').addEventListener('click', () => removeFile(index));
    fileList.appendChild(item);
  });
}

function clearFiles() {
  selectedFiles = [];
  renderFileList();
}

async function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = reader.result.split(',')[1];
      resolve({
        name: file.name,
        type: file.type || 'application/octet-stream',
        size: file.size,
        base64
      });
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function sendFilesToAI(aiType, files) {
  log(`${aiType}: 准备上传 ${files.length} 个文件...`);
  const fileDataArray = await Promise.all(files.map(readFileAsBase64));
  log(`${aiType}: 文件已编码，正在发送...`);

  return new Promise((resolve) => {
    chrome.runtime.sendMessage(
      { type: 'SEND_FILES', aiType, files: fileDataArray },
      (response) => {
        if (response?.success) {
          log(`${aiType}: 文件上传成功 (${files.length} 个)`, 'success');
        } else {
          log(`${aiType}: 文件上传失败 - ${response?.error || 'Unknown'}`, 'error');
        }
        resolve(response);
      }
    );
  });
}

// ============================================
// Persona Debate Mode Functions
// ============================================

function setupPersonaDebateMode() {
  // Populate role-map dropdowns dynamically
  populateRoleMap();

  // Start debate button
  document.getElementById('start-persona-debate').addEventListener('click', startPersonaDebate);

  // Abort button
  document.getElementById('abort-persona-debate').addEventListener('click', () => {
    personaDebateState.active = false;
    log('[人格辩论] 用户请求中止');
    publishDebateStatus();
    // UI update is handled by runPersonaDebate's finally block
    // (sendAndWait's abort checker will reject within 300ms)
  });

  // Role editor events
  document.getElementById('role-editor-close').addEventListener('click', closeRoleEditor);
  document.getElementById('role-editor-save').addEventListener('click', saveRoleEditor);
  document.getElementById('role-editor-reset').addEventListener('click', resetRoleEditor);

  // Load persisted role-model mapping
  loadRoleAIMap();

  // Load persisted custom personas
  loadCustomPersonas();

  // Import / Export buttons
  document.getElementById('export-role-map-btn').addEventListener('click', exportRoleMapConfig);
  document.getElementById('import-role-map-btn').addEventListener('click', () => {
    document.getElementById('import-role-map-input').click();
  });
  document.getElementById('import-role-map-input').addEventListener('change', importRoleMapConfig);
}

function populateRoleMap() {
  const container = document.getElementById('role-map-container');
  if (!container) return;
  container.innerHTML = '';

  const roles = [
    { key: 'ling', label: '凌·理性派' },
    { key: 'wen',  label: '温·感性派' },
    { key: 'mo',   label: '默·审问派' },
    { key: 'he',   label: '合·总结者' }
  ];

  for (const role of roles) {
    const persona = getEffectivePersona(role.key);
    const label = `${persona.name}·${persona.title}`;

    const row = document.createElement('div');
    row.className = 'role-row';

    // Role tag as a clickable button (opens customization editor)
    const tag = document.createElement('button');
    tag.className = `role-tag ${role.key}`;
    tag.textContent = label;
    tag.title = '点击自定义角色';
    tag.addEventListener('click', () => openRoleEditor(role.key));

    const select = document.createElement('select');
    select.id = `map-${role.key}`;
    for (const opt of AI_MODEL_OPTIONS) {
      const option = document.createElement('option');
      option.value = opt.value;
      option.textContent = opt.label;
      if (personaDebateState.roleAIMap[role.key] === opt.value) {
        option.selected = true;
      }
      select.appendChild(option);
    }

    row.appendChild(tag);
    row.appendChild(select);
    container.appendChild(row);
  }
}

// ============================================
// Role Customization Editor
// ============================================

let editingRoleKey = null;

function openRoleEditor(roleKey) {
  editingRoleKey = roleKey;
  const persona = getEffectivePersona(roleKey);
  const editor = document.getElementById('role-editor');
  const title = document.getElementById('role-editor-title');
  const nameInput = document.getElementById('edit-role-name');
  const titleInput = document.getElementById('edit-role-title');
  const stanceInput = document.getElementById('edit-role-stance');
  const promptInput = document.getElementById('edit-role-prompt');

  title.textContent = `编辑角色 · ${persona.name}·${persona.title}`;
  nameInput.value = persona.name;
  titleInput.value = persona.title;
  stanceInput.value = persona.stance;
  promptInput.value = persona.systemPrompt;

  editor.classList.remove('hidden');
}

function closeRoleEditor() {
  document.getElementById('role-editor').classList.add('hidden');
  editingRoleKey = null;
}

function saveRoleEditor() {
  if (!editingRoleKey) return;

  const name = document.getElementById('edit-role-name').value.trim() || PERSONAS[editingRoleKey].name;
  const title = document.getElementById('edit-role-title').value.trim() || PERSONAS[editingRoleKey].title;
  const stance = document.getElementById('edit-role-stance').value.trim() || PERSONAS[editingRoleKey].stance;
  const systemPrompt = document.getElementById('edit-role-prompt').value.trim() || PERSONAS[editingRoleKey].systemPrompt;

  // Store custom overrides
  if (!personaDebateState.customPersonas) personaDebateState.customPersonas = {};
  personaDebateState.customPersonas[editingRoleKey] = { name, title, stance, systemPrompt };

  // Persist to storage
  chrome.storage.local.set({ customPersonas: personaDebateState.customPersonas });

  // Update role tag labels
  populateRoleMap();
  closeRoleEditor();
  log(`[人格辩论] 角色「${name}·${title}」已保存`);
}

function resetRoleEditor() {
  if (!editingRoleKey) return;

  document.getElementById('edit-role-name').value = PERSONAS[editingRoleKey].name;
  document.getElementById('edit-role-title').value = PERSONAS[editingRoleKey].title;
  document.getElementById('edit-role-stance').value = PERSONAS[editingRoleKey].stance;
  document.getElementById('edit-role-prompt').value = PERSONAS[editingRoleKey].systemPrompt;
}

// Get effective persona (custom override if exists, otherwise default)
function getEffectivePersona(roleKey) {
  const base = PERSONAS[roleKey];
  const custom = personaDebateState.customPersonas?.[roleKey];
  if (custom) {
    return { ...base, ...custom };
  }
  return base;
}

function loadCustomPersonas() {
  chrome.storage.local.get('customPersonas', (result) => {
    if (result.customPersonas) {
      personaDebateState.customPersonas = result.customPersonas;
      populateRoleMap(); // Re-render with custom labels
    }
  });
}

function startPersonaDebate() {
  // Read UI values into state
  personaDebateState.topic = document.getElementById('persona-topic').value.trim();
  if (!personaDebateState.topic) {
    log('[人格辩论] 请先输入议题', 'error');
    return;
  }

  personaDebateState.debateRounds = parseInt(document.getElementById('debate-rounds').value);

  // Read role-model mapping from dropdowns
  for (const role of ['ling', 'wen', 'mo', 'he']) {
    const sel = document.getElementById('map-' + role);
    if (sel) personaDebateState.roleAIMap[role] = sel.value;
  }

  // Save mapping for next session
  saveRoleAIMap();

  // Auto-open split-screen dashboard in a new tab
  publishDebateStatus();
  chrome.runtime.sendMessage({ type: 'OPEN_SPLITVIEW' });
  log('[分屏视图] 已自动打开');

  // Show active area (status line only, no debate log), hide setup
  document.getElementById('persona-setup').classList.add('hidden');
  document.getElementById('debate-active-area').classList.remove('hidden');
  document.getElementById('debate-topic-display').textContent = personaDebateState.topic;

  // Start the debate
  runPersonaDebate();
}

/**
 * Send message to an AI and wait for its response to be captured.
 * Uses an independent one-time listener on RESPONSE_CAPTURED.
 * This is the serial orchestration core — one AI at a time.
 */
function sendAndWait(aiType, message) {
  return new Promise((resolve, reject) => {
    let settled = false;

    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        clearInterval(abortChecker);
        chrome.runtime.onMessage.removeListener(handler);
        reject(new Error(`${aiType} 响应超时（10 分钟）`));
      }
    }, 620000);

    // Abort checker: polls debate active state every 300ms
    // If user clicks abort, this rejects immediately instead of waiting for timeout
    const abortChecker = setInterval(() => {
      if (!personaDebateState.active && !settled) {
        settled = true;
        clearTimeout(timeout);
        clearInterval(abortChecker);
        chrome.runtime.onMessage.removeListener(handler);
        reject(new Error('用户中止了辩论'));
      }
    }, 300);

    const handler = (msg) => {
      if (msg.type === 'RESPONSE_CAPTURED' && msg.aiType === aiType && !settled) {
        settled = true;
        clearTimeout(timeout);
        clearInterval(abortChecker);
        chrome.runtime.onMessage.removeListener(handler);
        if (msg.error) {
          reject(new Error(msg.error));
        } else {
          resolve(msg.content);
        }
      }
    };
    chrome.runtime.onMessage.addListener(handler);

    // Trigger the send (reuses existing sendToAI)
    sendToAI(aiType, message).catch((err) => {
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        clearInterval(abortChecker);
        chrome.runtime.onMessage.removeListener(handler);
        reject(err);
      }
    });
  });
}

/**
 * Build the debate prompt for a given role and round.
 * @param {string} role - Persona key (ling/wen/mo)
 * @param {number} round - Current round (0 = opening, 1+ = rebuttal)
 * @param {Array} history - Prior debate history [{ role, aiType, round, content }]
 * @param {string} topic - The debate topic
 */
function buildDebatePrompt(role, round, history, topic) {
  const persona = getEffectivePersona(role);
  let prompt = `${persona.systemPrompt}\n\n`;
  prompt += `【讨论议题】${topic}\n\n`;

  if (round === 0) {
    prompt += `这是第 1 轮立场阐述。请从你「${persona.name}·${persona.title}」的立场，就上述议题阐述你的核心观点。`;
  } else {
    prompt += `以下是第 1 ~ ${round} 轮各方的发言记录：\n\n`;
    for (const h of history) {
      const hp = getEffectivePersona(h.role);
      prompt += `<${hp.name}（${hp.title}）第${h.round + 1}轮发言>\n${h.content}\n</${hp.name}的发言>\n\n`;
    }
    prompt += `现在是第 ${round + 1} 轮。请作为「${persona.name}·${persona.title}」，针对以上发言进行反驳与深化，坚持你的角色立场。`;
  }
  return prompt;
}

/**
 * Build the summary prompt for the summarizer (合).
 */
function buildSummaryPrompt(history, topic) {
  const persona = getEffectivePersona('he');
  let prompt = `${persona.systemPrompt}\n\n`;
  prompt += `【讨论议题】${topic}\n\n`;
  prompt += `以下是完整的辩论记录：\n\n`;
  for (const h of history) {
    const hp = getEffectivePersona(h.role);
    prompt += `<${hp.name}（${hp.title}）第${h.round + 1}轮发言>\n${h.content}\n</${hp.name}的发言>\n\n`;
  }
  prompt += `请基于以上全部辩论记录，生成终局结构化总结。`;
  return prompt;
}

/**
 * Main orchestration function: 4-persona serial debate + summary.
 * Flow: Round 0 (opening) → Round 1~N (rebuttal) → Summary
 */
async function runPersonaDebate() {
  const state = personaDebateState;
  let completed = false;

  state.active = true;
  state.history = [];
  state.currentRole = null;
  state.currentRound = 0;
  updateDebateUI('running');
  publishDebateStatus();

  try {
    // ===== Phase 1 + 2: Serial debate (round 0 opening + round 1~N rebuttal) =====
    const totalRounds = state.debateRounds + 1; // includes opening round
    for (let round = 0; round < totalRounds; round++) {
      state.currentPhase = round === 0 ? 'opening' : 'rebuttal';
      state.currentRound = round + 1;
      const phaseLabel = round === 0 ? '立场阐述' : `第 ${round + 1} 轮反驳`;
      updateDebatePhase(round + 1, phaseLabel);
      log(`[人格辩论] 第 ${round + 1} 轮开始（${state.currentPhase}）`);
      publishDebateStatus();

      for (const role of state.roleOrder) {
        // Check abort
        if (!state.active) {
          log('[人格辩论] 已中止', 'error');
          publishDebateStatus();
          return;
        }

        const aiType = state.roleAIMap[role];
        const persona = getEffectivePersona(role);
        state.currentRole = role;
        log(`[人格辩论] ${persona.name}（${persona.title}）发言中 → ${aiType}`);
        renderDebateStatusLine(`${persona.name}（${persona.title}）发言中...`);
        publishDebateStatus();

        const prompt = buildDebatePrompt(role, round, state.history, state.topic);
        const content = await sendAndWait(aiType, prompt);

        state.history.push({ role, aiType, round, content });
        log(`[人格辩论] ${persona.name} 发言完成（${content.length} 字）`, 'success');
        renderDebateTurn(role, round, content, aiType);
        publishDebateStatus();
      }
    }

    // ===== Phase 3: Summary =====
    if (!state.active) {
      log('[人格辩论] 已中止', 'error');
      publishDebateStatus();
      return;
    }

    state.currentPhase = 'summary';
    state.currentRole = state.summarizer;
    updateDebatePhase(totalRounds + 1, '终局总结');
    const sumAI = state.roleAIMap[state.summarizer];
    log(`[人格辩论] 总结者「合」生成总结中 → ${sumAI}`);
    renderDebateStatusLine('合·全局分析 生成总结中...');
    publishDebateStatus();

    const summaryPrompt = buildSummaryPrompt(state.history, state.topic);
    const summary = await sendAndWait(sumAI, summaryPrompt);

    renderSummary(summary);
    log('[人格辩论] 全部完成', 'success');
    renderDebateStatusLine('辩论完成');
    completed = true;

  } catch (err) {
    log('[人格辩论] 中断：' + err.message, 'error');
    renderDebateStatusLine('辩论中断：' + err.message);
  } finally {
    state.currentPhase = 'done';
    state.currentRole = null;
    state.active = false;
    updateDebateUI(completed ? 'idle' : 'aborted');
    publishDebateStatus();
  }
}

// ============================================
// Persona Debate UI Rendering
// (Debate content is shown in the split-screen tab;
//  the side panel only shows a compact status line.)
// ============================================

function renderDebateTurn(role, round, content, aiType) {
  // No-op: turns are rendered in the split-screen dashboard, not the side panel
  const p = getEffectivePersona(role);
  log(`[人格辩论] ${p.name} 发言已同步至分屏视图`);
}

function renderSummary(summary) {
  // No-op: summary is rendered in the split-screen dashboard
  log('[人格辩论] 总结已同步至分屏视图');
}

function updateDebateUI(state) {
  const startBtn = document.getElementById('start-persona-debate');
  const abortBtn = document.getElementById('abort-persona-debate');
  const setupEl = document.getElementById('persona-setup');
  const activeEl = document.getElementById('debate-active-area');

  if (state === 'running') {
    startBtn.disabled = true;
    abortBtn.disabled = false;
    setupEl.classList.add('hidden');
    activeEl.classList.remove('hidden');
  } else if (state === 'aborted') {
    // Aborted: hide active area, return to clean setup page
    startBtn.disabled = false;
    abortBtn.disabled = true;
    setupEl.classList.remove('hidden');
    activeEl.classList.add('hidden');
  } else {
    // idle (completed normally): keep active area visible so user can read results
    startBtn.disabled = false;
    abortBtn.disabled = true;
    setupEl.classList.remove('hidden');
  }
}

function updateDebatePhase(round, phaseLabel) {
  const roundBadge = document.getElementById('debate-round-badge');
  const phaseBadge = document.getElementById('debate-phase-badge');
  if (roundBadge) roundBadge.textContent = `第 ${round} 轮`;
  if (phaseBadge) phaseBadge.textContent = phaseLabel;
}

function renderDebateStatusLine(text) {
  const statusEl = document.getElementById('debate-status-line');
  if (statusEl) {
    statusEl.textContent = text;
  }
}

// ============================================
// Role-Model Mapping Persistence
// ============================================

async function saveRoleAIMap() {
  const map = personaDebateState.roleAIMap;
  await chrome.storage.local.set({ personaRoleAIMap: map });
}

async function loadRoleAIMap() {
  try {
    const result = await chrome.storage.local.get('personaRoleAIMap');
    if (result.personaRoleAIMap) {
      personaDebateState.roleAIMap = { ...DEFAULT_ROLE_AI_MAP, ...result.personaRoleAIMap };
      // Backfill to UI dropdowns
      for (const role of ['ling', 'wen', 'mo', 'he']) {
        const sel = document.getElementById('map-' + role);
        if (sel) sel.value = personaDebateState.roleAIMap[role];
      }
    }
  } catch (err) {
    console.log('[AI Panel] Failed to load role-AI map:', err.message);
  }
}

// ============================================
// Import / Export role-map config (role-AI mapping + custom personas)
// ============================================

function exportRoleMapConfig() {
  // Read current UI state for role-AI mapping
  const map = {};
  for (const role of ['ling', 'wen', 'mo', 'he']) {
    const sel = document.getElementById('map-' + role);
    if (sel) map[role] = sel.value;
  }

  const config = {
    version: 1,
    exportedAt: new Date().toISOString(),
    roleAIMap: map
  };

  // Only export custom personas that the user actually customized
  const custom = personaDebateState.customPersonas || {};
  if (Object.keys(custom).length > 0) {
    config.personas = custom;
  }

  const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = `ai-roundtable-role-config-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  log('[角色设置] 已导出配置文件', 'success');
}

function importRoleMapConfig(e) {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (event) => {
    try {
      const config = JSON.parse(event.target.result);

      // Validate config
      if (!config.roleAIMap || !config.roleAIMap.ling) {
        log('[角色设置] 无效的配置文件：缺少角色-模型映射', 'error');
        return;
      }

      // Apply role-AI mapping (overrides existing defaults)
      for (const role of ['ling', 'wen', 'mo', 'he']) {
        if (config.roleAIMap[role]) {
          personaDebateState.roleAIMap[role] = config.roleAIMap[role];
          const sel = document.getElementById('map-' + role);
          if (sel) sel.value = config.roleAIMap[role];
        }
      }
      saveRoleAIMap();

      // Apply custom persona overrides (only replaces what's in the file)
      const personas = config.personas || config.customPersonas || {};
      if (Object.keys(personas).length > 0) {
        personaDebateState.customPersonas = { ...personas };
        chrome.storage.local.set({ customPersonas: personas });
        populateRoleMap();
      }

      log('[角色设置] 已导入配置文件', 'success');
    } catch (err) {
      log('[角色设置] 导入失败：' + err.message, 'error');
    }
  };

  reader.readAsText(file);

  // Reset file input so the same file can be re-imported
  e.target.value = '';
}

// ============================================
// Split View — publish debate status to session storage
// The split-screen dashboard tab reads this to track phase / current speaker / role-AI map.
// ============================================

function publishDebateStatus() {
  const s = personaDebateState;
  const status = {
    mode: 'debate',
    active: s.active,
    topic: s.topic,
    currentPhase: s.currentPhase,
    currentRound: s.currentRound || 0,
    currentRole: s.currentRole || null,
    roleAIMap: { ...s.roleAIMap },
    roleOrder: [...s.roleOrder],
    summarizer: s.summarizer,
    debateRounds: s.debateRounds,
    historyCount: s.history.length,
    customPersonas: s.customPersonas || {}
  };
  try {
    chrome.runtime.sendMessage({ type: 'PUBLISH_DEBATE_STATUS', status });
  } catch (err) {
    // Side panel context may be invalid; ignore
  }
}

// ============================================
// Split View — publish discussion status to session storage
// ============================================

function publishDiscussionStatus() {
  const s = discussionState;
  const status = {
    mode: 'discussion',
    active: s.active,
    topic: s.topic,
    currentRound: s.currentRound || 0,
    participants: [...s.participants],
    roundType: s.roundType || null,
    pendingResponses: [...s.pendingResponses],
    historyCount: s.history.length
  };
  try {
    chrome.runtime.sendMessage({ type: 'PUBLISH_DEBATE_STATUS', status });
  } catch (err) {
    // Side panel context may be invalid; ignore
  }
}
