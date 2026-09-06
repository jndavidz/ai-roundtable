// AI Roundtable - shared constants for every extension surface
//
// Single source of truth for the supported AI list: URL patterns, display
// names and hostname→aiType helpers. Loaded as a plain classic script so it
// works everywhere without a build step:
//   - background service worker: importScripts('shared/constants.js')
//   - side panel / split view:   <script src="...">  before their controllers
//
// Adding a new AI therefore means touching this table (plus manifest.json
// content_scripts/host_permissions and one content/<ai>.js adapter) instead of
// hand-copying the same tables into panel.js / splitview.js.

const AI_URL_PATTERNS = {
  claude: ['claude.ai'],
  chatgpt: ['chat.openai.com', 'chatgpt.com'],
  gemini: ['gemini.google.com'],
  deepseek: ['chat.deepseek.com'],
  glm: ['chatglm.cn', 'z.ai'],
  kimi: ['kimi.com'],
  grok: ['grok.com'],
  qianwen: ['qianwen.com', 'tongyi.aliyun.com'],
  mimo: ['xiaomimimo.com'],
  minimax: ['minimaxi.com', 'minimax.io'],
  doubao: ['doubao.com'],
  hunyuan: ['yuanbao.tencent.com']
};

// Home URLs used when a model's tab is missing and the side panel asks the
// background to open one (A-plan auto-open). Based on the hosts actually in
// use; keep in sync with AI_URL_PATTERNS.
const AI_HOME_URLS = {
  claude: 'https://claude.ai/new',
  chatgpt: 'https://chatgpt.com/',
  gemini: 'https://gemini.google.com/app',
  deepseek: 'https://chat.deepseek.com/',
  glm: 'https://chatglm.cn/',
  kimi: 'https://www.kimi.com/',
  grok: 'https://grok.com/',
  qianwen: 'https://www.qianwen.com/',
  mimo: 'https://aistudio.xiaomimimo.com/',
  minimax: 'https://agent.minimaxi.com/',
  doubao: 'https://www.doubao.com/',
  hunyuan: 'https://yuanbao.tencent.com/'
};

const AI_TYPES = Object.keys(AI_URL_PATTERNS);

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

// Hostname-suffix match: exact host or a subdomain of the pattern, with the
// leading "www." stripped. Using the hostname (not the raw URL string) avoids
// false positives like https://evil.com/?r=kimi.com or notkimi.com
function hostnameMatches(hostname, pattern) {
  if (hostname === pattern) return true;
  return hostname.endsWith('.' + pattern);
}

function getAITypeFromUrl(url) {
  if (!url) return null;
  let hostname;
  try {
    hostname = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch (err) {
    return null;
  }
  for (const [aiType, patterns] of Object.entries(AI_URL_PATTERNS)) {
    if (patterns.some(p => hostnameMatches(hostname, p))) {
      return aiType;
    }
  }
  return null;
}
