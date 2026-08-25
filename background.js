// AI Panel - Background Service Worker

// Shared AI tables (URL patterns / display names / hostname helpers) live in
// shared/constants.js — the single source of truth also used by the side panel
// and split view. Must be imported before anything reads AI_URL_PATTERNS.
importScripts('shared/constants.js');

// Content-script file per AI. The filename convention is content/<aiType>.js.
const AI_SITE_SCRIPTS = {};
for (const aiType of AI_TYPES) {
  AI_SITE_SCRIPTS[aiType] = `content/${aiType}.js`;
}

// Every site script depends on the shared helper stack (content/dom-utils.js +
// content/base.js), which must be injected first, in order. The list is derived
// from the site scripts so a new AI can never be registered with an incomplete
// file list again — previously base.js (and dom-utils.js for chatgpt) were
// missing, so on-demand re-injection into an already-open tab silently no-opped
// at `if (!window.AIPanelBase?.boot(AI_TYPE)) return;` and messages never
// reached the page even though the tab was "connected".
const CONTENT_SCRIPT_FILES = {};
for (const [aiType, siteScript] of Object.entries(AI_SITE_SCRIPTS)) {
  CONTENT_SCRIPT_FILES[aiType] = ['content/dom-utils.js', 'content/base.js', siteScript];
}

// Store latest responses using chrome.storage.session (persists across service worker restarts)
// Always expose every known AI key (derived from AI_URL_PATTERNS) so callers get
// a consistent shape even for AIs that have never produced a response.
function emptyResponses() {
  const responses = {};
  for (const aiType of Object.keys(AI_URL_PATTERNS)) {
    responses[aiType] = null;
  }
  return responses;
}

async function getStoredResponses() {
  const result = await chrome.storage.session.get('latestResponses');
  const stored = result.latestResponses || {};
  // Backfill any newly added AI with null while preserving existing values
  const responses = emptyResponses();
  for (const aiType of Object.keys(responses)) {
    if (Object.prototype.hasOwnProperty.call(stored, aiType)) {
      responses[aiType] = stored[aiType];
    }
  }
  return responses;
}

async function setStoredResponse(aiType, content) {
  const responses = await getStoredResponses();
  responses[aiType] = content;
  await chrome.storage.session.set({ latestResponses: responses });
}

// Open side panel when extension icon is clicked
chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ windowId: tab.windowId });
});

// Set side panel behavior
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

// Listen for messages from side panel and content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender)
    .then(sendResponse)
    .catch((err) => sendResponse({ success: false, error: err.message }));
  return true; // Keep channel open for async response
});

async function handleMessage(message, sender) {
  switch (message.type) {
    case 'SEND_MESSAGE':
      return await sendMessageToAI(message.aiType, message.message);

    case 'SEND_FILES':
      return await sendFilesToAI(message.aiType, message.files);

    case 'GET_RESPONSE':
      // Query content script directly for real-time response (not from storage)
      return await getResponseFromContentScript(message.aiType);

    case 'CHECK_CONNECTION':
      // Liveness probe used by the side panel to verify a content script is
      // actually reachable (and re-inject it if it went missing).
      return await checkAIConnection(message.aiType);

    case 'RESPONSE_CAPTURED':
      // Content script captured a response
      await setStoredResponse(message.aiType, message.content);
      // Forward to side panel (include content for discussion mode)
      notifySidePanel('RESPONSE_CAPTURED', { aiType: message.aiType, content: message.content });
      return { success: true };

    case 'CONTENT_SCRIPT_READY':
      // Content script loaded and ready
      const aiType = getAITypeFromUrl(sender.tab?.url);
      if (aiType) {
        notifySidePanel('TAB_STATUS_UPDATE', { aiType, connected: true });
      }
      return { success: true };

    case 'OPEN_SPLITVIEW':
      // Open the split-screen dashboard in a new tab
      await chrome.tabs.create({ url: chrome.runtime.getURL('sidepanel/splitview.html') });
      return { success: true };

    case 'SPLITVIEW_POLL':
      // Single poll: return debate status + latest responses for all mapped AIs
      return await handleSplitviewPoll();

    case 'PUBLISH_DEBATE_STATUS':
      // Side panel publishes debate state to session storage for the split view
      // to read. A terminal status (active: false, published on end/abort/reset)
      // clears the stored status so a freshly opened split view never shows a
      // stale, already-finished debate.
      if (message.status && message.status.active === false) {
        await chrome.storage.session.remove('debateStatus');
      } else {
        await chrome.storage.session.set({ debateStatus: message.status });
      }
      return { success: true };

    default:
      return { error: 'Unknown message type' };
  }
}

// ===== Split View support =====
async function handleSplitviewPoll() {
  // Read published status (covers both debate and discussion modes)
  const statusResult = await chrome.storage.session.get('debateStatus');
  const status = statusResult.debateStatus || null;

  // Determine which AIs to poll based on mode
  let aiTypes = ['claude', 'chatgpt', 'deepseek', 'glm'];
  if (status) {
    if (status.mode === 'discussion' && status.participants) {
      // Discussion mode: poll the 2 participants
      aiTypes = status.participants;
    } else if (status.roleAIMap) {
      // Debate mode: poll all mapped AIs
      const mapped = Object.values(status.roleAIMap);
      aiTypes = [...new Set(mapped)]; // dedupe
    }
  }

  // Fetch latest responses in parallel (real-time DOM content from content scripts)
  const responses = {};
  await Promise.all(aiTypes.map(async (ai) => {
    try {
      const resp = await getResponseFromContentScript(ai);
      responses[ai] = resp.content || '';
    } catch (e) {
      responses[ai] = '';
    }
  }));

  return { debateStatus: status, responses };
}

async function checkAIConnection(aiType) {
  try {
    const tab = await findAITab(aiType);
    if (!tab) return { connected: false, reason: 'no-tab' };
    // Ping the content script; sendMessageToContentScript re-injects it if it
    // went missing (e.g. the tab was opened before the extension was loaded).
    await sendMessageToContentScript(tab, aiType, { type: 'PING' });
    return { connected: true };
  } catch (err) {
    return { connected: false, reason: err.message };
  }
}

async function getResponseFromContentScript(aiType) {
  try {
    const tab = await findAITab(aiType);
    if (!tab) {
      // Fallback to stored response if tab not found
      const responses = await getStoredResponses();
      return { content: responses[aiType] };
    }

    // Query content script for real-time DOM content
    const response = await chrome.tabs.sendMessage(tab.id, {
      type: 'GET_LATEST_RESPONSE'
    });

    return { content: response?.content || null };
  } catch (err) {
    // Fallback to stored response on error
    console.log('[AI Panel] Failed to get response from content script:', err.message);
    const responses = await getStoredResponses();
    return { content: responses[aiType] };
  }
}

async function sendMessageToAI(aiType, message) {
  try {
    // Find the tab for this AI
    const tab = await findAITab(aiType);

    if (!tab) {
      return { success: false, error: `No ${aiType} tab found` };
    }

    console.log('[AI Panel] Sending message to', aiType, 'tab:', tab.url);

    const response = await sendMessageToContentScript(tab, aiType, {
      type: 'INJECT_MESSAGE',
      message
    });

    // Pin affinity only on a successful send; failures leave the previous
    // choice (or none) so the next turn re-scores tabs normally.
    if (response?.success && tab.id !== undefined) {
      lastUsedTabIdByAI[aiType] = tab.id;
    }

    // Notify side panel
    notifySidePanel('SEND_RESULT', {
      aiType,
      success: response?.success,
      error: response?.error
    });

    return response;
  } catch (err) {
    notifySidePanel('SEND_RESULT', {
      aiType,
      success: false,
      error: err.message
    });
    return { success: false, error: err.message };
  }
}

async function sendMessageToContentScript(tab, aiType, payload) {
  try {
    return await chrome.tabs.sendMessage(tab.id, payload);
  } catch (err) {
    if (!shouldRetryContentScriptError(err)) throw err;

    console.log('[AI Panel] Content script missing/stale for', aiType, 'injecting into tab:', tab.url);
    await injectContentScripts(tab.id, aiType);

    // Scripts boot synchronously (dom-utils → base → site), but a freshly
    // injected or still-navigating page may take a moment to register its
    // listener, so retry a couple of times with a small backoff.
    for (let attempt = 1; attempt <= 2; attempt++) {
      await sleep(300 * attempt);
      try {
        return await chrome.tabs.sendMessage(tab.id, payload);
      } catch (retryErr) {
        if (!shouldRetryContentScriptError(retryErr)) throw retryErr;
      }
    }
    throw new Error(`Content script for ${aiType} did not respond after injection`);
  }
}

function shouldRetryContentScriptError(err) {
  const message = err?.message || '';
  return message.includes('Receiving end does not exist') ||
         message.includes('Extension context invalidated') ||
         message.includes('Could not establish connection') ||
         // The content script's async listener (return true) lost its response
         // port before sendResponse — its context was destroyed mid-flight
         // (e.g. the page navigated). Re-injecting and retrying is the best
         // way to self-heal; the trade-off is a possible duplicate message.
         message.includes('message channel closed before a response was received') ||
         message.includes('message port closed before a response was received');
}

async function injectContentScripts(tabId, aiType) {
  const files = CONTENT_SCRIPT_FILES[aiType];
  if (!files) return;

  await chrome.scripting.executeScript({
    target: { tabId },
    files
  });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function sendFilesToAI(aiType, files) {
  console.log('[AI Panel] Background: sendFilesToAI called for', aiType, 'files:', files?.length);
  try {
    const tab = await findAITab(aiType);

    if (!tab) {
      console.log('[AI Panel] Background: No tab found for', aiType);
      return { success: false, error: `No ${aiType} tab found` };
    }

    console.log('[AI Panel] Background: Sending INJECT_FILES to tab', tab.id, tab.url);
    const response = await sendMessageToContentScript(tab, aiType, {
      type: 'INJECT_FILES',
      files
    });

    console.log('[AI Panel] Background: Response from content script:', response);
    return response;
  } catch (err) {
    console.log('[AI Panel] Background: sendFilesToAI error:', err.message);
    return { success: false, error: err.message };
  }
}

// Remember which tab last accepted a message per AI. Debates run many turns
// over minutes, and findAITab's scoring includes an active-tab bonus — without
// affinity, the user merely switching window focus could silently redirect the
// rest of a debate to a different chat tab of the same model (fresh session,
// no context). The remembered tab gets a bonus above any natural score.
const lastUsedTabIdByAI = {};
const LAST_USED_TAB_BONUS = 200;

async function findAITab(aiType) {
  const patterns = AI_URL_PATTERNS[aiType];
  if (!patterns) return null;

  const tabs = await chrome.tabs.query({});
  const scoredTabs = [];

  for (const tab of tabs) {
    let score = scoreAITab(aiType, tab);
    if (score > -Infinity) {
      if (tab.id === lastUsedTabIdByAI[aiType]) score += LAST_USED_TAB_BONUS;
      scoredTabs.push({ tab, score });
    }
  }

  scoredTabs.sort((a, b) => b.score - a.score);
  return scoredTabs[0]?.tab || null;
}

// Hostname matching + URL→aiType resolution come from shared/constants.js.

// Chat-path bonuses for the ten adapters whose rule is the same shape:
// "pathname contains any of these prefixes → +100, otherwise +30".
// claude and mimo have bespoke rules below (exact paths / hash routing).
const AI_CHAT_PREFIXES = {
  chatgpt: ['/c/'],
  gemini: ['/app/'],
  deepseek: ['/chat/', '/a/chat/'],
  glm: ['/chat/', '/main/'],
  kimi: ['/chat/', '/conversation/'],
  grok: ['/conversation/', '/chat/'],
  qianwen: ['/chat/', '/conversation/'],
  minimax: ['/chat/', '/agent/'],
  doubao: ['/chat/', '/conversation/'],
  hunyuan: ['/chat/', '/conversation/']
};

function scoreAITab(aiType, tab) {
  if (!tab.url) return -Infinity;

  let url;
  try {
    url = new URL(tab.url);
  } catch (err) {
    return -Infinity;
  }

  const hostname = url.hostname.toLowerCase().replace(/^www\./, '');
  const patterns = AI_URL_PATTERNS[aiType];
  if (!patterns?.some(p => hostnameMatches(hostname, p))) return -Infinity;

  let score = 0;
  if (tab.active) score += 30;
  if (!tab.discarded) score += 10;
  // Recency bonus: full +20 for a tab accessed moments ago, decaying to +0
  // over a 5-minute window. Previously this divided two epoch timestamps
  // (lastAccessed / Date.now()), which is always ≈ 1.0 and gave every tab +20.
  if (typeof tab.lastAccessed === 'number') {
    const recencyMs = Math.max(0, Date.now() - tab.lastAccessed);
    const recencyWindowMs = 5 * 60 * 1000;
    const recency = Math.max(0, 1 - recencyMs / recencyWindowMs);
    score += 20 * recency;
  }

  const prefixes = AI_CHAT_PREFIXES[aiType];
  if (prefixes) {
    score += prefixes.some(p => url.pathname.includes(p)) ? 100 : 30;
    return score;
  }

  if (aiType === 'claude') {
    if (url.hostname !== 'claude.ai') return -Infinity;

    // Claude Design and static/documentation surfaces also live under
    // claude.ai but do not expose the normal chat composer.
    if (url.pathname.startsWith('/design/')) return -Infinity;
    if (url.pathname.startsWith('/settings')) return -Infinity;

    if (url.pathname.startsWith('/chat/')) score += 120;
    else if (url.pathname === '/new' || url.pathname === '/') score += 100;
    else score += 20;
  }

  if (aiType === 'mimo') {
    // MiMo uses hash-based routing (#/c for chat)
    if (url.hash.includes('/c') || url.pathname.includes('/chat/')) score += 100;
    else score += 30;
  }

  return score;
}

async function notifySidePanel(type, data) {
  try {
    await chrome.runtime.sendMessage({ type, ...data });
  } catch (err) {
    // Side panel might not be open, ignore
  }
}

// Track tab updates
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url) {
    const aiType = getAITypeFromUrl(tab.url);
    if (aiType) {
      notifySidePanel('TAB_STATUS_UPDATE', { aiType, connected: true });
    }
  }
});

// No tab-closure tracking needed: findAITab() queries live tabs on every call,
// and the side panel re-checks its status dots on load and on TAB_STATUS_UPDATE.
