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
  minimax: ['minimaxi.com', 'minimax.io', 'minimax.cn'],
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
  minimax: 'https://agent.minimax.cn/',
  doubao: 'https://www.doubao.com/',
  // ⚠️ 不能用裸首页 https://yuanbao.tencent.com/ —— 服务端会把它重定向回
  // 最近会话(可能正是临时对话，再次落入 ?chatMode=temp 的坑)。
  // 用元宝「新建对话」对应的无 query route(CDP 实测: 整页重载为全新普通
  // 会话，temp=false，后续发送不再翻转回 temp)。
  hunyuan: 'https://yuanbao.tencent.com/chat/naQivTmsDa'
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

// 临时/一次性对话面不保存历史、DOM 结构也不同（Claude incognito 缺
// user-message 容器、混元临时对话 ?chatMode=temp），群发进去既丢上下文
// 也不留档。tab 选择与状态灯一律视为「该站不可用」，由调用方走新建
// 普通 tab 的路径。新增同类站点时在此追加一行，勿在调用点散落 if。
function isEphemeralChatUrl(url) {
  let u;
  try {
    u = new URL(url);
  } catch (err) {
    return false;
  }
  const host = u.hostname.toLowerCase().replace(/^www\./, '');
  if (host === 'claude.ai' && u.searchParams.has('incognito')) return true;
  if (host === 'yuanbao.tencent.com' && u.searchParams.get('chatMode') === 'temp') return true;
  return false;
}
