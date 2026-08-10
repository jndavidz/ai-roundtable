// AI Roundtable - Split View Dashboard Controller
// Supports two modes:
//   - 'debate': 4-role persona debate (2x2 grid)
//   - 'discussion': 2-AI discussion (1x2 grid)
// Polls background for real-time status + streaming responses, renders panels.

// ===== Role metadata (mirrors personas.js) =====
const ROLE_INFO = {
  ling: { name: '凌', title: '理性派', subtitle: '逻辑拆解 · 论证链评估' },
  wen:  { name: '温', title: '感性派', subtitle: '人文视角 · 情绪轮廓' },
  mo:   { name: '默', title: '审问派', subtitle: '反例 · 边界条件' },
  he:   { name: '合', title: '全局分析', subtitle: '终局结构化总结' }
};

const AI_NAMES = {
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

const PANEL_ORDER = ['ling', 'wen', 'mo', 'he'];

// Get effective role info (custom override if exists)
function getRoleInfo(role, customPersonas) {
  const base = ROLE_INFO[role];
  const custom = customPersonas?.[role];
  if (custom) {
    return {
      name: custom.name || base.name,
      title: custom.title || base.title,
      subtitle: custom.stance ? custom.stance : base.subtitle
    };
  }
  return base;
}

// ===== State =====
let currentMode = null;       // 'debate' | 'discussion' | null
let panelState = {};          // key -> { el, body, status, aiType, turns:[], streaming:'', lastSnapshotContent:'', userScrolledUp:false }
let lastRebuildKey = '';      // Track when to rebuild panels
let prevCurrentSpeaker = null;
let currentCustomPersonas = {};
let pollTimer = null;
let hadSession = false;       // Have we ever rendered a real session? (retains results after it ends)
const POLL_INTERVAL = 800;  // ms

// ===== Init =====
document.addEventListener('DOMContentLoaded', () => {
  buildEmptyPanels();
  startPolling();
  document.getElementById('sv-refresh-btn').addEventListener('click', pollOnce);
});

// ===== Build placeholder panels before first poll =====
function buildEmptyPanels() {
  const grid = document.getElementById('sv-grid');
  grid.innerHTML = '';
  grid.className = 'sv-grid';
  grid.innerHTML = `<div class="sv-placeholder-center">等待讨论或辩论开始…</div>`;
}

// ===== Build / rebuild panels for DEBATE mode (4 panels, 2x2) =====
function buildDebatePanels(roleAIMap) {
  const defaultMap = { ling: 'deepseek', wen: 'glm', mo: 'chatgpt', he: 'claude' };
  const map = roleAIMap || defaultMap;
  const grid = document.getElementById('sv-grid');
  grid.innerHTML = '';
  grid.className = 'sv-grid sv-grid-4';
  panelState = {};

  for (const role of PANEL_ORDER) {
    const info = getRoleInfo(role, currentCustomPersonas);
    const ai = map[role] || 'claude';
    const aiName = AI_NAMES[ai] || ai;

    const panel = document.createElement('div');
    panel.className = 'sv-panel';
    panel.dataset.role = role;

    panel.innerHTML = `
      <div class="sv-panel-header">
        <div class="sv-panel-id">
          <span class="sv-role-tag ${role}">${info.name}</span>
          <div>
            <div class="sv-role-title">${info.name}·${info.title}</div>
            <div class="sv-role-subtitle">${info.subtitle}</div>
          </div>
        </div>
        <div class="sv-panel-meta">
          <span class="sv-panel-ai">${aiName}</span>
          <span class="sv-panel-status sv-status-idle">待机</span>
        </div>
      </div>
      <div class="sv-panel-body">
        <div class="sv-placeholder">等待 ${info.name} 发言…</div>
      </div>
    `;

    grid.appendChild(panel);
    initPanelState(panel, role, ai);
  }
}

// ===== Build / rebuild panels for DISCUSSION mode (2 panels, 1x2) =====
function buildDiscussionPanels(participants) {
  const grid = document.getElementById('sv-grid');
  grid.innerHTML = '';
  grid.className = 'sv-grid sv-grid-2';
  panelState = {};

  for (const ai of participants) {
    const aiName = AI_NAMES[ai] || ai;
    const key = ai; // Use AI type as key in discussion mode

    const panel = document.createElement('div');
    panel.className = 'sv-panel';
    panel.dataset.ai = ai;

    panel.innerHTML = `
      <div class="sv-panel-header">
        <div class="sv-panel-id">
          <span class="sv-role-tag sv-ai-tag">${aiName}</span>
          <div>
            <div class="sv-role-title">${aiName}</div>
            <div class="sv-role-subtitle">讨论参与者</div>
          </div>
        </div>
        <div class="sv-panel-meta">
          <span class="sv-panel-status sv-status-idle">待机</span>
        </div>
      </div>
      <div class="sv-panel-body">
        <div class="sv-placeholder">等待 ${aiName} 发言…</div>
      </div>
    `;

    grid.appendChild(panel);
    initPanelState(panel, key, ai);
  }
}

// ===== Initialize panel state object and scroll listeners =====
function initPanelState(panel, key, aiType) {
  panelState[key] = {
    el: panel,
    body: panel.querySelector('.sv-panel-body'),
    status: panel.querySelector('.sv-panel-status'),
    aiType: aiType,
    turns: [],
    streaming: '',
    lastSnapshotContent: '',
    hasContent: false,
    userScrolledUp: false
  };

  const bodyEl = panelState[key].body;
  bodyEl.addEventListener('scroll', () => {
    const ps = panelState[key];
    if (!ps) return;
    const nearBottom = bodyEl.scrollHeight - bodyEl.scrollTop - bodyEl.clientHeight < 40;
    ps.userScrolledUp = !nearBottom;
  });
  bodyEl.addEventListener('mousedown', () => {
    const ps = panelState[key];
    if (ps) ps.userScrolledUp = true;
  });
  bodyEl.addEventListener('mouseup', () => {
    const ps = panelState[key];
    if (!ps) return;
    const nearBottom = bodyEl.scrollHeight - bodyEl.scrollTop - bodyEl.clientHeight < 40;
    ps.userScrolledUp = !nearBottom;
  });
}

// ===== Polling =====
function startPolling() {
  pollOnce();
  pollTimer = setInterval(pollOnce, POLL_INTERVAL);
}

async function pollOnce() {
  try {
    const resp = await chrome.runtime.sendMessage({ type: 'SPLITVIEW_POLL' });
    if (resp) handlePollResponse(resp);
  } catch (e) {
    // Background service worker may be starting up; retry next interval
  }
}

// ===== Handle poll response =====
function handlePollResponse(data) {
  const { debateStatus, responses } = data;

  // Determine mode - treat sessions with no useful data as idle
  const rawMode = debateStatus?.mode || null;
  const hasParticipants = (debateStatus?.participants?.length > 0);
  const hasRoleMap = (debateStatus?.roleAIMap && Object.keys(debateStatus.roleAIMap).length > 0);

  // If mode has no config data, treat as idle (show placeholder)
  const mode = (rawMode === 'discussion' && !hasParticipants) ? null
             : (rawMode === 'debate' && !hasRoleMap) ? null
             : rawMode;

  if (mode) hadSession = true;

  // A finished/aborted session clears the stored status (debateStatus: null).
  // Keep the last rendered panels on screen marked as "已完成" instead of
  // resetting to the idle placeholder — only a freshly opened split view that
  // never saw a real session shows the placeholder.
  if (!mode && hadSession) {
    const doneStatus = {
      ...debateStatus,
      mode: currentMode,
      active: false,
      finished: true,
      topic: debateStatus?.topic || ''
    };
    updateToolbar(doneStatus);
    markPanelsDone();
    return;
  }

  // Mode change → rebuild panels
  if (mode !== currentMode) {
    currentMode = mode;
    prevCurrentSpeaker = null;
    if (mode === 'debate') {
      currentCustomPersonas = debateStatus?.customPersonas || {};
      buildDebatePanels(debateStatus?.roleAIMap);
      lastRebuildKey = JSON.stringify(debateStatus?.roleAIMap) + '|' + JSON.stringify(currentCustomPersonas);
    } else if (mode === 'discussion') {
      buildDiscussionPanels(debateStatus?.participants || []);
      lastRebuildKey = JSON.stringify(debateStatus?.participants);
    } else {
      buildEmptyPanels();
      lastRebuildKey = '';
      updateToolbar(debateStatus);
      return;
    }
  }

  // Rebuild on config change within same mode
  if (mode === 'debate' && debateStatus?.roleAIMap) {
    const rebuildKey = JSON.stringify(debateStatus.roleAIMap) + '|' + JSON.stringify(debateStatus.customPersonas || {});
    if (rebuildKey !== lastRebuildKey) {
      currentCustomPersonas = debateStatus.customPersonas || {};
      buildDebatePanels(debateStatus.roleAIMap);
      lastRebuildKey = rebuildKey;
    }
  } else if (mode === 'discussion' && debateStatus?.participants?.length > 0) {
    const rebuildKey = JSON.stringify(debateStatus.participants);
    if (rebuildKey !== lastRebuildKey) {
      buildDiscussionPanels(debateStatus.participants);
      lastRebuildKey = rebuildKey;
    }
  }

  updateToolbar(debateStatus);

  // Route to mode-specific handler
  if (mode === 'debate') {
    handleDebatePoll(debateStatus, responses);
  } else if (mode === 'discussion') {
    handleDiscussionPoll(debateStatus, responses);
  }
}

// Mark every panel as finished after the session ends (its status was cleared).
// Keeps the last rendered results visible instead of reverting to the placeholder.
function markPanelsDone() {
  Object.values(panelState).forEach(ps => {
    ps.el?.classList.remove('sv-active');
    if (ps.status) {
      ps.status.textContent = '已完成';
      ps.status.className = 'sv-panel-status sv-status-done';
    }
  });
}

// ===== Debate mode poll handler =====
function handleDebatePoll(debateStatus, responses) {
  const currentRole = debateStatus?.currentRole || null;
  const currentRound = debateStatus?.currentRound ?? 0;
  const phase = debateStatus?.currentPhase || null;
  const roleMap = debateStatus?.roleAIMap || {};

  // Detect role transition: snapshot previous role's content
  if (prevCurrentSpeaker && prevCurrentSpeaker !== currentRole && panelState[prevCurrentSpeaker]) {
    snapshotTurn(prevCurrentSpeaker, currentRound, phase);
  }
  if (phase === 'done' && prevCurrentSpeaker && panelState[prevCurrentSpeaker]) {
    snapshotTurn(prevCurrentSpeaker, currentRound, phase);
    prevCurrentSpeaker = null;
  }

  for (const role of PANEL_ORDER) {
    const ai = roleMap[role] || panelState[role]?.aiType || 'claude';
    const content = responses[ai] || '';
    const isSpeaking = (currentRole === role);
    updatePanel(role, content, isSpeaking, debateStatus);
  }

  prevCurrentSpeaker = currentRole;
}

// ===== Discussion mode poll handler =====
function handleDiscussionPoll(discStatus, responses) {
  const participants = discStatus?.participants || [];
  const pending = discStatus?.pendingResponses || [];
  const roundType = discStatus?.roundType || null;
  const currentRound = discStatus?.currentRound || 0;

  // In discussion mode, both AIs may respond simultaneously.
  // We treat each AI as "speaking" if it's in pendingResponses (hasn't finished yet)
  // and the discussion is active.

  for (const ai of participants) {
    const content = responses[ai] || '';
    const isPending = pending.includes(ai);
    const isSpeaking = discStatus?.active && isPending;
    const ps = panelState[ai];

    if (!ps) continue;

    // Detect completion transition: was pending, now not → snapshot
    if (ps.wasPending && !isPending) {
      snapshotDiscussionTurn(ai, currentRound, roundType);
    }

    updatePanel(ai, content, isSpeaking, discStatus);
    ps.wasPending = isPending;
  }
}

// ===== Snapshot a completed turn into history (debate mode) =====
function snapshotTurn(role, round, phase) {
  const ps = panelState[role];
  if (!ps) return;
  const content = ps.streaming || ps.lastSnapshotContent;
  if (content && content.trim().length > 0 && content !== ps.lastSnapshotContent) {
    let label;
    if (phase === 'summary' || role === 'he') {
      label = '终局总结';
    } else if (round <= 1) {
      label = '立场阐述';
    } else {
      label = `第 ${round} 轮`;
    }
    ps.turns.push({ label, content });
    ps.lastSnapshotContent = content;
  }
  ps.streaming = '';
}

// ===== Snapshot a completed turn into history (discussion mode) =====
function snapshotDiscussionTurn(ai, round, roundType) {
  const ps = panelState[ai];
  if (!ps) return;
  const content = ps.streaming || ps.lastSnapshotContent;
  if (content && content.trim().length > 0 && content !== ps.lastSnapshotContent) {
    let label;
    if (roundType === 'summary') {
      label = '总结';
    } else if (roundType === 'cross-eval') {
      label = `第 ${round} 轮 交叉评价`;
    } else {
      label = `第 ${round} 轮`;
    }
    ps.turns.push({ label, content });
    ps.lastSnapshotContent = content;
  }
  ps.streaming = '';
}

// ===== Update a single panel =====
function updatePanel(key, content, isSpeaking, status) {
  const ps = panelState[key];
  if (!ps) return;

  const isActive = status?.active && isSpeaking;

  // Highlight active panel
  ps.el.classList.toggle('sv-active', isActive);

  // When a panel transitions to "speaking", reset its scroll lock
  if (isActive && !ps.wasActive) {
    ps.userScrolledUp = false;
  }
  ps.wasActive = isActive;

  // If speaking, update streaming content
  if (isSpeaking && content) {
    ps.streaming = content;
    ps.hasContent = true;
  }

  // Determine status label
  let statusLabel, statusClass;
  if (!status?.active && !ps.hasContent) {
    statusLabel = '待机'; statusClass = 'sv-status-idle';
  } else if (isSpeaking) {
    statusLabel = '发言中'; statusClass = 'sv-status-speaking';
  } else if (ps.hasContent || ps.turns.length > 0) {
    statusLabel = '已完成'; statusClass = 'sv-status-done';
  } else {
    statusLabel = '等待中'; statusClass = 'sv-status-waiting';
  }
  ps.status.textContent = statusLabel;
  ps.status.className = 'sv-panel-status ' + statusClass;

  // Render body: completed turns + current streaming
  renderPanelBody(key, isSpeaking);
}

// ===== Render panel body =====
function renderPanelBody(key, isSpeaking) {
  const ps = panelState[key];
  if (!ps) return;
  const body = ps.body;

  const hasTurns = ps.turns.length > 0;
  const hasStreaming = ps.streaming.trim().length > 0;

  if (!hasTurns && !hasStreaming) {
    if (body.querySelector('.sv-placeholder')) return; // keep placeholder
    const displayName = currentMode === 'debate'
      ? getRoleInfo(key, currentCustomPersonas).name
      : (AI_NAMES[ps.aiType] || ps.aiType);
    body.innerHTML = `<div class="sv-placeholder">等待 ${displayName} 发言…</div>`;
    return;
  }

  let html = '';
  for (const turn of ps.turns) {
    html += `<div class="sv-turn-block">`;
    html += `<div class="sv-turn-label">${escapeHtml(turn.label)}</div>`;
    html += `<div class="sv-turn-text">${escapeHtml(turn.content)}</div>`;
    html += `</div>`;
  }

  if (hasStreaming) {
    html += `<div class="sv-turn-block sv-streaming-block">`;
    if (hasTurns) {
      const lbl = currentMode === 'debate'
        ? ((key === 'he') ? '终局总结' : '当前发言')
        : '当前发言';
      html += `<div class="sv-turn-label sv-turn-label-live">${escapeHtml(lbl)}</div>`;
    }
    html += `<div class="sv-turn-text">${escapeHtml(ps.streaming)}`;
    if (isSpeaking) {
      html += `<span class="sv-typing-cursor"></span>`;
    }
    html += `</div></div>`;
  }

  body.innerHTML = html;

  // Auto-scroll to bottom ONLY if the user hasn't scrolled up
  if (!ps.userScrolledUp) {
    body.scrollTop = body.scrollHeight;
  }
}

// ===== Toolbar =====
function updateToolbar(status) {
  const phaseBadge = document.getElementById('sv-phase-badge');
  const roundDisplay = document.getElementById('sv-round-display');
  const topicDisplay = document.getElementById('sv-topic-display');

  if (!status || !status.active) {
    if (status?.finished) {
      // Session ended — keep the final results on screen with a "已完成" badge
      phaseBadge.textContent = '已完成';
      phaseBadge.style.background = '#10b981';
      roundDisplay.textContent = status.mode === 'discussion' ? '讨论结束' : '辩论结束';
      topicDisplay.textContent = status?.topic || '';
    } else {
      phaseBadge.textContent = status?.mode === 'discussion' ? '讨论待机' : '辩论待机';
      phaseBadge.style.background = '#374151';
      roundDisplay.textContent = '';
      topicDisplay.textContent = status?.topic || '';
    }
    return;
  }

  if (status.mode === 'discussion') {
    // Discussion mode toolbar
    const typeLabels = {
      'initial': '初始发言',
      'cross-eval': '交叉评价',
      'summary': '生成总结',
      'counter': '反驳'
    };
    phaseBadge.textContent = typeLabels[status.roundType] || '讨论中';
    phaseBadge.style.background = status.roundType === 'summary' ? '#10b981' : '#3b82f6';
    roundDisplay.textContent = `第 ${status.currentRound || 1} 轮`;
    topicDisplay.textContent = status.topic || '';
  } else {
    // Debate mode toolbar
    const phaseLabels = {
      opening: '立场阐述',
      rebuttal: '反驳轮',
      summary: '终局总结',
      done: '已完成'
    };
    phaseBadge.textContent = phaseLabels[status.currentPhase] || status.currentPhase || '进行中';
    phaseBadge.style.background = (status.currentPhase === 'done') ? '#10b981' : '#3b82f6';

    const round = status.currentRound || 1;
    if (status.currentPhase === 'summary') {
      roundDisplay.textContent = '总结阶段';
    } else if (status.currentPhase === 'done') {
      roundDisplay.textContent = '辩论结束';
    } else {
      roundDisplay.textContent = `第 ${round} 轮`;
    }
    topicDisplay.textContent = status.topic || '';
  }
}

// ===== Utils =====
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text || '';
  return div.innerHTML;
}
