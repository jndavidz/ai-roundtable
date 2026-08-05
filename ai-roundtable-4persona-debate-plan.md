# 4 人格轮流辩论 + 总结 改造方案

> 基于 [axtonliu/ai-roundtable](https://github.com/axtonliu/ai-roundtable)（MIT, Chrome 扩展, 纯网页端, 无 API Key）

**目标：** 在 ai-roundtable 现有"网页端自动化 + 互评/交叉引用"基础上，新增「4 人格轮流辩论 + 独立总结」模式，支持为每个模型注入性格气质（凌/温/默/合），实现轮流发言、互相反驳、终局结构化总结。

**架构：** 不改 content 脚本（claude.js/chatgpt.js/gemini.js 的注入与流式捕获逻辑保持不变），仅在侧边栏层（sidepanel/）新增人格配置模块与串行编排引擎；人格通过"消息前置 prompt"注入，总结者读取全部发言历史生成结构化总结。

**技术栈：** Manifest V3 Chrome 扩展、原生 JavaScript、chrome.runtime 消息中转、chrome.storage.local 持久化。

---

## 一、现状分析与改造切入点

### 1.1 现有架构关键点

| 模块 | 文件 | 作用 | 改造关系 |
|---|---|---|---|
| 侧边栏控制 | `sidepanel/panel.js` | 讨论状态机、消息解析、发送编排 | **主要改造对象** |
| 侧边栏 UI | `sidepanel/panel.html` | 模式切换、参与者勾选、讨论控制按钮 | 新增人格辩论 UI |
| 消息中转 | `background.js` | Service Worker，转发 SEND_MESSAGE/GET_RESPONSE | 基本不动 |
| 页面注入 | `content/claude.js` 等 | 注入文本到编辑器、自动提交、流式完成检测 | **不动** |
| 扩展配置 | `manifest.json` | Manifest V3 | 新增 personas.js 引用 |

### 1.2 可复用的现有能力

经源码核查，以下函数/机制可直接复用，无需重写：

- `sendToAI(aiType, message)` — 向指定 AI 注入并发送消息（经 background 中转到 content 脚本）。
- `getLatestResponse(aiType)` — 抓取某 AI 最新一条回复文本。
- `RESPONSE_CAPTURED` 消息 — content 脚本在流式完成后自动上报（`waitForStreamingComplete` 轮询稳定 2 秒后触发），最长等待 10 分钟，天然适配串行编排。
- `handleMutualReview` 的 XML 标签包裹模式 — `<{ai}_response>...</{ai}_response>`，可复用为辩论历史传递格式。

### 1.3 现有讨论模式的局限

```js
// panel.js 现有状态（仅支持 2 人）
let discussionState = {
  active: false,
  topic: '',
  participants: [],  // [ai1, ai2]  ← 硬编码 2 人
  currentRound: 0,
  history: [],
  pendingResponses: new Set(),
  roundType: null    // 'initial', 'cross-eval', 'counter'
};
```

局限点：参与者固定 2 人；无人格注入；轮次类型固定三段式；无独立总结者角色；无角色—模型映射。

---

## 二、模型用量分析与角色—模型映射

### 2.1 为什么不能让 Claude 在讨论中过多使用

Claude 网页免费版限制严格：约 **30-50 条消息/天**（每5小时滚动窗口 15-40 条，北京时间早8点重置）[$TRAE_REF](https://www.claude-anthropic.com/guide/75.html)[$TRAE_REF](https://logicity.in/en/blog/claude-ai-free-tier-in-2026-limits-workarounds-and-costs)。在 4 人格辩论中，若 Claude 担任「凌」每轮发言：

- 1 轮立场 + 2 轮反驳 = 凌发言 3 次；若同时兼「合」总结 = +1 次 → 每议题消耗 Claude **4 条**。
- 跑 8-10 个议题即耗尽当日 Claude 额度，且中途被限速会直接中断编排。

**结论：Claude 应只承担「合·总结者」（每议题仅 1 次发言）。** 这样 30-50 条/天可支撑 30-50 个议题，绰绰有余。高频的「凌/温/默」交给免费额度更宽松、且中文语境更强的国内主流模型。

### 2.2 候选模型网页端调研结论（用户指定清单）

> 用户指定候选：GLM、DeepSeek、Grok、ChatGPT、Claude、Gemini。以下为 2026-07-30 核实结果。

| 模型 | 实际版本 | 网页端 | 免费额度 | 适配角色倾向 | 自动化可行性 |
|---|---|---|---|---|---|
| DeepSeek | V4（含 V4-Pro 专家模式） | chat.deepseek.com | 网页端基础对话免费、不限次数 [$TRAE_REF](https://cj.sina.cn/articles/view/7879848900/1d5acf3c40680312we)[$TRAE_REF](https://www.readaitime.com/deepseek) | 推理/逻辑拆解 → 适合「凌」 | 高（textarea） |
| 智谱 GLM | GLM-5.2（2026-06-17 上线开源） | chatglm.cn / z.ai | 免费满血版 [$TRAE_REF](https://www.zhipuai.cn/zh/research/161)[$TRAE_REF](https://www.sohu.com/a/1037588154_121123923) | Coding/长程任务/中文表达 → 适合「凌/默/合」 | 高（textarea） |
| ChatGPT | GPT-5 系列 | chatgpt.com | 免费版有限制但较宽松 | 发散质询、全能 → 适合「默」 | 原生支持 |
| Gemini | Gemini 3 系列 | gemini.google.com | 免费版较宽松 | 表达丰富、多模态 → 适合「温」 | 原生支持 |
| Grok | Grok 4.5（2026-07-08 发布） | grok.com | **免费版仅 fast 模式可用**，国内需翻墙 [$TRAE_REF](https://segmentfault.com/a/1190000048006965)[$TRAE_REF](https://blog.csdn.net/nmdbbzcl/article/details/163002585) | 反传统、敢于挑战 → 气质契合「默」但免费档为 fast 降级版 | 中（需翻墙+选择器适配） |
| Claude | Sonnet 4 / Opus 4 | claude.ai | 30-50 条/天 [$TRAE_REF](https://www.claude-anthropic.com/guide/75.html) | 结构化总结最强 → 适合「合」 | 原生支持 |

**关键提醒：Grok 免费版只有 fast 模式。** Grok 4.5 免费层仅开放 fast 模式（低推理预算的快速响应版），完整能力需订阅。fast 模式推理深度有限，担任需要严密反例质询的「默」可能力度不足；且国内访问需翻墙。因此 **Grok 更适合作为可切换的备选角色**，若用户已订阅解锁完整模式则可自由分配。

### 2.3 推荐角色—模型映射（已考虑用量与气质）

**主推映射（默认，4 角色各占独立标签页）：**

| 角色 | 讨论定位 | 默认承载模型 | 用量/议题 | 选择理由 |
|---|---|---|---|---|
| 凌 — 理性派 | 逻辑拆解，论证链评估 | **DeepSeek V4 Pro** | 3 次 | 推理专长、逻辑拆解出色，网页端免费不限次数，完美承担高频逻辑分析 |
| 温 — 感性派 | 人文视角，情绪轮廓 | **GLM 5.2** | 3 次 | 中文表达好、1M上下文；主攻Coding故感性非最强项，但人格prompt可引导人文视角，且免费满血不限次 |
| 默 — 审问派 | 反例，边界条件 | **ChatGPT** | 3 次 | 发散质询、挑刺找反例能力强，免费版额度较宽松 |
| 合 — 全局分析 | 终局结构化总结 | **Claude Sonnet** | 1 次（仅总结） | 结构化总结最强；每议题仅1次，30-50条/天可支撑30+议题，用量无忧 |

此映射下 4 角色各占独立标签页，上下文互不污染。用量核算：每议题共10次发言，仅1次落在Claude。需新增 DeepSeek 与 GLM 两个 content 脚本（见第七章）；ChatGPT/Claude 为 ai-roundtable 原生支持。

**备选映射 A（Claude 做温，气质更优但用量受限，每天约10-16议题）：**

| 角色 | 模型 | 备注 |
|---|---|---|
| 凌 | DeepSeek V4 Pro | |
| 温 | Claude Sonnet | 文字温度与共情力最契合温，但3次/议题用量消耗快 |
| 默 | ChatGPT | |
| 合 | GLM 5.2 | 1M上下文能消化全部辩论历史做总结，结构化能力不错 |

**备选映射 B（Claude 不可用时，GLM 做总结）：**

| 角色 | 模型 | 备注 |
|---|---|---|
| 凌 | DeepSeek V4 Pro | |
| 温 | GLM 5.2 | |
| 默 | ChatGPT | |
| 合 | GLM 5.2 | 复用同标签页，1M上下文适合消化全史 |

**Grok 的定位：** Grok 4.5 免费版仅 fast 模式可用（推理深度有限），且国内需翻墙，因此仅作为 UI 中可手动切换的备选角色（适合偶尔想换口味时让 Grok 客串「默」一次），不进入默认映射。若用户已订阅解锁完整模式，可自由分配。

**注：** 以上映射均可在 UI 中由用户自由修改并持久化（见 Task 5）。

---

## 三、人格 Prompt 模板

以下为 4 个角色的完整 system prompt，作为每条注入消息的前置文本。设计原则：每段 prompt 包含「身份定位 + 发言原则 + 语言风格 + 输出约束」，确保角色气质稳定。

### 3.1 凌 — 理性派

```
你是「凌」，一位理性派分析者，正在参加一场多人圆桌辩论。

【你的讨论定位】逻辑拆解与论证链评估。

【发言原则】
1. 聚焦逻辑结构：拆解每个观点的前提、推理链条与结论。
2. 评估论证严密性：指出逻辑跳跃、滑坡、以偏概全等谬误。
3. 用证据和推理说话，不使用情绪化或煽动性表达。
4. 当他人观点存在逻辑漏洞时，直接指出并给出修正方向。
5. 自己发言时，先给出明确结论，再展开论证。

【语言风格】克制、精准、条理化。善用「前提—推理—结论」结构。

【输出约束】单次发言控制在 300 字以内，聚焦一个核心论点。
```

### 3.2 温 — 感性派

```
你是「温」，一位感性派思考者，正在参加一场多人圆桌辩论。

【你的讨论定位】人文视角与情绪轮廓。

【发言原则】
1. 关注议题对「人」的影响：情感、尊严、价值取向、生活处境。
2. 从人文、伦理、心理维度，补充被纯理性视角忽视的部分。
3. 描绘不同立场下相关者的情绪轮廓与真实处境。
4. 当讨论变得过于冰冷或工具化时，提醒关注人的维度。
5. 可以共情他人的观点，但要从人文立场给出独立判断。

【语言风格】温润、共情、有画面感。可适当使用隐喻与场景描写。

【输出约束】单次发言控制在 300 字以内，聚焦一个核心论点。
```

### 3.3 默 — 审问派

```
你是「默」，一位审问派质询者，正在参加一场多人圆桌辩论。

【你的讨论定位】反例与边界条件。

【发言原则】
1. 主动寻找他人观点的反例与失效场景。
2. 施压边界条件：在什么极端或边缘情况下，该观点会崩塌？
3. 使用「如果……是否还成立？」式的质询。
4. 不急于给出自己的答案，而是暴露他人假设的脆弱性。
5. 必要时承认对方观点的合理范围，再指出其边界之外的风险。

【语言风格】简短、锋利、直击要害。少铺垫，多提问。

【输出约束】单次发言控制在 250 字以内，至少提出一个反例或边界质询。
```

### 3.4 合 — 全局分析（总结者）

```
你是「合」，一位全局分析者，担任本次圆桌辩论的总结者。

【你的总结定位】终局结构化总结。

【总结原则】
1. 忠实整合所有发言者的观点、分歧与共识，不引入新观点。
2. 按以下结构输出：
   一、核心议题复述
   二、各方立场摘要（凌/温/默各自的核心观点）
   三、关键分歧点（各方对立或张力所在）
   四、达成共识的部分
   五、未决问题与风险
   六、可执行的结论或下一步建议
3. 保持中立全局视角，不偏向任何一方。
4. 若各方存在明显盲区，可在「未决问题」中点明。

【语言风格】清晰、结构化、全局视角。使用编号与小标题。

【输出约束】总结不超过 600 字，严格遵循上述六段结构。
```

---

## 四、编排逻辑设计

### 4.1 辩论流程总览

```
议题输入
  │
  ▼
阶段 1 · 立场阐述（第 1 轮，串行）
  凌 ──发言──► [等待回复捕获]
  温 ──发言──► [等待回复捕获]   （温收到：议题 + 自己人格）
  默 ──发言──► [等待回复捕获]
  │
  ▼
阶段 2 · 互相反驳（第 2~N 轮，串行，默认 N=2）
  凌 ──反驳──► [收到：议题 + 人格 + 第1轮全部发言]
  温 ──反驳──► [收到：议题 + 人格 + 第1轮全部发言 + 凌本轮发言]
  默 ──反驳──► [收到：议题 + 人格 + 前序所有发言]
  │  （重复至第 N 轮）
  ▼
阶段 3 · 终局总结
  合 ──总结──► [收到：议题 + 合人格 + 全部辩论历史]
  │
  ▼
输出结构化总结，结束
```

**关键设计：**
- **串行非并行**：一人发完且回复被捕获后，才轮到下一人，避免回复错位（现有 `RESPONSE_CAPTURED` 机制保证流式完成后再推进）。
- **人格前置注入**：每条注入消息 = `[角色 system prompt]\n\n[议题 + 历史]\n\n[本轮指令]`，content 脚本无需改动。
- **历史累积传递**：第 N 轮的每人都收到此前所有人的全部发言（XML 标签包裹，复用现有格式）。
- **总结者旁观**：合 不参与辩论，最后一次性读取全部 history。

### 4.2 核心数据结构

```js
// 新增于 personas.js，由 panel.js 引用

// 角色定义
const PERSONAS = {
  ling: {
    name: '凌',
    title: '理性派',
    stance: '逻辑拆解，论证链评估',
    systemPrompt: `你是「凌」，一位理性派分析者，正在参加一场多人圆桌辩论。
【你的讨论定位】逻辑拆解与论证链评估。
【发言原则】
1. 聚焦逻辑结构：拆解每个观点的前提、推理链条与结论。
2. 评估论证严密性：指出逻辑跳跃、滑坡、以偏概全等谬误。
3. 用证据和推理说话，不使用情绪化或煽动性表达。
4. 当他人观点存在逻辑漏洞时，直接指出并给出修正方向。
5. 自己发言时，先给出明确结论，再展开论证。
【语言风格】克制、精准、条理化。善用「前提—推理—结论」结构。
【输出约束】单次发言控制在 300 字以内，聚焦一个核心论点。`,
    participatesInDebate: true
  },
  wen: {
    name: '温',
    title: '感性派',
    stance: '人文视角，情绪轮廓',
    systemPrompt: `你是「温」，一位感性派思考者，正在参加一场多人圆桌辩论。
【你的讨论定位】人文视角与情绪轮廓。
【发言原则】
1. 关注议题对「人」的影响：情感、尊严、价值取向、生活处境。
2. 从人文、伦理、心理维度，补充被纯理性视角忽视的部分。
3. 描绘不同立场下相关者的情绪轮廓与真实处境。
4. 当讨论变得过于冰冷或工具化时，提醒关注人的维度。
5. 可以共情他人的观点，但要从人文立场给出独立判断。
【语言风格】温润、共情、有画面感。可适当使用隐喻与场景描写。
【输出约束】单次发言控制在 300 字以内，聚焦一个核心论点。`,
    participatesInDebate: true
  },
  mo: {
    name: '默',
    title: '审问派',
    stance: '反例，边界条件',
    systemPrompt: `你是「默」，一位审问派质询者，正在参加一场多人圆桌辩论。
【你的讨论定位】反例与边界条件。
【发言原则】
1. 主动寻找他人观点的反例与失效场景。
2. 施压边界条件：在什么极端或边缘情况下，该观点会崩塌？
3. 使用「如果……是否还成立？」式的质询。
4. 不急于给出自己的答案，而是暴露他人假设的脆弱性。
5. 必要时承认对方观点的合理范围，再指出其边界之外的风险。
【语言风格】简短、锋利、直击要害。少铺垫，多提问。
【输出约束】单次发言控制在 250 字以内，至少提出一个反例或边界质询。`,
    participatesInDebate: true
  },
  he: {
    name: '合',
    title: '全局分析',
    stance: '终局结构化总结',
    systemPrompt: `你是「合」，一位全局分析者，担任本次圆桌辩论的总结者。
【你的总结定位】终局结构化总结。
【总结原则】
1. 忠实整合所有发言者的观点、分歧与共识，不引入新观点。
2. 按以下结构输出：
   一、核心议题复述
   二、各方立场摘要（凌/温/默各自的核心观点）
   三、关键分歧点（各方对立或张力所在）
   四、达成共识的部分
   五、未决问题与风险
   六、可执行的结论或下一步建议
3. 保持中立全局视角，不偏向任何一方。
4. 若各方存在明显盲区，可在「未决问题」中点明。
【语言风格】清晰、结构化、全局视角。使用编号与小标题。
【输出约束】总结不超过 600 字，严格遵循上述六段结构。`,
    participatesInDebate: false  // 总结者不参与辩论
  }
};

// 角色 → 模型映射（用户可在 UI 修改并持久化）
// 默认：DeepSeek V4 Pro / GLM 5.2 / ChatGPT 高频讨论，Claude Sonnet 仅做总结者
const DEFAULT_ROLE_AI_MAP = {
  ling: 'deepseek',
  wen: 'glm',
  mo: 'chatgpt',
  he: 'claude'   // 总结者仅发言1次/议题，30-50条/天可支撑30+议题
};

// 辩论编排状态
let personaDebateState = {
  active: false,
  topic: '',
  debateRounds: 2,        // 反驳轮数（不含第1轮立场阐述）
  roleOrder: ['ling', 'wen', 'mo'],  // 辩论发言顺序
  summarizer: 'he',
  roleAIMap: { ...DEFAULT_ROLE_AI_MAP },
  history: [],            // [{ role, aiType, round, content }]
  currentPhase: null      // 'opening' | 'rebuttal' | 'summary' | 'done'
};
```

### 4.3 核心编排函数

以下为需新增到 `panel.js` 的完整编排逻辑。

```js
// ============================================
// 人格辩论编排引擎
// ============================================

/**
 * 发送消息并等待该 AI 的回复被捕获（串行编排核心）
 * 复用现有 sendToAI + RESPONSE_CAPTURED 机制
 */
function sendAndWait(aiType, message) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        chrome.runtime.onMessage.removeListener(handler);
        reject(new Error(`${aiType} 响应超时（10 分钟）`));
      }
    }, 620000); // 略大于 content 脚本的 600s 上限

    const handler = (msg) => {
      if (msg.type === 'RESPONSE_CAPTURED' && msg.aiType === aiType && !settled) {
        settled = true;
        clearTimeout(timeout);
        chrome.runtime.onMessage.removeListener(handler);
        resolve(msg.content);
      }
    };
    chrome.runtime.onMessage.addListener(handler);

    // 触发发送（现有函数）
    sendToAI(aiType, message).catch((err) => {
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        chrome.runtime.onMessage.removeListener(handler);
        reject(err);
      }
    });
  });
}

/**
 * 构建辩论发言 prompt
 * @param {string} role - 角色键（ling/wen/mo）
 * @param {number} round - 当前轮次（0 = 立场阐述）
 * @param {Array} history - 已有发言历史
 * @param {string} topic - 议题
 */
function buildDebatePrompt(role, round, history, topic) {
  const persona = PERSONAS[role];
  let prompt = `${persona.systemPrompt}\n\n`;
  prompt += `【讨论议题】${topic}\n\n`;

  if (round === 0) {
    prompt += `这是第 1 轮立场阐述。请从你「${persona.name}·${persona.title}」的立场，就上述议题阐述你的核心观点。`;
  } else {
    prompt += `以下是第 1 ~ ${round} 轮各方的发言记录：\n\n`;
    for (const h of history) {
      const hp = PERSONAS[h.role];
      prompt += `<${hp.name}（${hp.title}）第${h.round + 1}轮发言>\n${h.content}\n</${hp.name}的发言>\n\n`;
    }
    prompt += `现在是第 ${round + 1} 轮。请作为「${persona.name}·${persona.title}」，针对以上发言进行反驳与深化，坚持你的角色立场。`;
  }
  return prompt;
}

/**
 * 构建总结 prompt
 */
function buildSummaryPrompt(history, topic) {
  const persona = PERSONAS.he;
  let prompt = `${persona.systemPrompt}\n\n`;
  prompt += `【讨论议题】${topic}\n\n`;
  prompt += `以下是完整的辩论记录：\n\n`;
  for (const h of history) {
    const hp = PERSONAS[h.role];
    prompt += `<${hp.name}（${hp.title}）第${h.round + 1}轮发言>\n${h.content}\n</${hp.name}的发言>\n\n`;
  }
  prompt += `请基于以上全部辩论记录，生成终局结构化总结。`;
  return prompt;
}

/**
 * 主编排函数：4 人格轮流辩论 + 总结
 */
async function runPersonaDebate() {
  const state = personaDebateState;
  if (!state.topic.trim()) {
    log('[人格辩论] 请先输入议题', 'error');
    return;
  }

  state.active = true;
  state.history = [];
  updateDebateUI('running');

  try {
    // ===== 阶段 1 + 2：轮流辩论（第 0 轮立场 + 第 1~N 轮反驳）=====
    const totalRounds = state.debateRounds + 1; // 含立场阐述轮
    for (let round = 0; round < totalRounds; round++) {
      state.currentPhase = round === 0 ? 'opening' : 'rebuttal';
      log(`[人格辩论] 第 ${round + 1} 轮开始（${state.currentPhase}）`);

      for (const role of state.roleOrder) {
        const aiType = state.roleAIMap[role];
        const persona = PERSONAS[role];
        log(`[人格辩论] ${persona.name}（${persona.title}）发言中 → ${aiType}`);

        const prompt = buildDebatePrompt(role, round, state.history, state.topic);
        const content = await sendAndWait(aiType, prompt);

        state.history.push({ role, aiType, round, content });
        log(`[人格辩论] ${persona.name} 发言完成（${content.length} 字）`, 'success');
        renderDebateTurn(role, round, content); // 渲染到 UI
      }
    }

    // ===== 阶段 3：终局总结 =====
    state.currentPhase = 'summary';
    const sumAI = state.roleAIMap[state.summarizer];
    log(`[人格辩论] 总结者「合」生成总结中 → ${sumAI}`);
    const summaryPrompt = buildSummaryPrompt(state.history, state.topic);
    const summary = await sendAndWait(sumAI, summaryPrompt);

    renderSummary(summary);
    log('[人格辩论] 全部完成', 'success');

  } catch (err) {
    log('[人格辩论] 中断：' + err.message, 'error');
  } finally {
    state.currentPhase = 'done';
    state.active = false;
    updateDebateUI('idle');
  }
}
```

### 4.4 与现有消息监听的兼容

现有 `panel.js` 的 `RESPONSE_CAPTURED` 监听器在讨论模式激活时会调用 `handleDiscussionResponse`。新增 `sendAndWait` 使用独立的一次性监听器，二者通过 `aiType` 区分，互不干扰。但需确保：当人格辩论激活时，旧讨论模式的回调不会被误触发。在现有监听器中加入守卫：

```js
// panel.js 现有监听器中，修改 RESPONSED_CAPTURED 分支
} else if (message.type === 'RESPONSE_CAPTURED') {
  log(`${message.aiType}: Response captured`, 'success');
  // 旧讨论模式（保持原逻辑，加守卫）
  if (discussionState.active && !personaDebateState.active
      && discussionState.pendingResponses.has(message.aiType)) {
    handleDiscussionResponse(message.aiType, message.content);
  }
  // 人格辩论由 sendAndWait 的独立监听器处理，此处不干预
}
```

---

## 五、文件结构与改动清单

### 5.1 新增文件

| 文件 | 职责 |
|---|---|
| `sidepanel/personas.js` | 4 角色定义、默认角色—模型映射、辩论状态对象 |

### 5.2 修改文件

| 文件 | 改动 |
|---|---|
| `manifest.json` | `sidepanel` 不需声明（扩展页面内联引用），但在 `web_accessible_resources` 确认 personas.js 可访问；实际上只需在 panel.html 中 `<script src="personas.js">` |
| `sidepanel/panel.html` | 新增「人格辩论」模式 UI：议题输入、轮数选择、角色—模型映射表、开始/中止按钮、辩论记录区、总结区 |
| `sidepanel/panel.css` | 新增人格辩论 UI 样式（角色色卡、轮次分隔、总结高亮） |
| `sidepanel/panel.js` | 新增 `sendAndWait`/`buildDebatePrompt`/`buildSummaryPrompt`/`runPersonaDebate`/`renderDebateTurn`/`renderSummary`/`updateDebateUI`；修改 `RESPONSE_CAPTURED` 监听器加守卫；新增人格辩论模式的事件绑定 |

### 5.3 不改动文件

`background.js`、`content/claude.js`、`content/chatgpt.js`、`content/gemini.js` — 消息中转与页面注入逻辑完全复用。

---

## 六、分任务实施计划

> 以下任务可顺序执行。每个任务完成后手动在浏览器加载扩展验证。无现成测试框架，采用「改动 → 加载扩展 → 手动验证」循环。

### Task 1：新增人格配置模块

**文件：**
- 创建：`sidepanel/personas.js`

- [ ] **Step 1：创建 personas.js，写入完整角色定义**

将「四、4.2 核心数据结构」中的 `PERSONAS`、`DEFAULT_ROLE_AI_MAP`、`personaDebateState` 完整写入 `sidepanel/personas.js`。文件末尾无需导出（扩展页面全局作用域共享）。

- [ ] **Step 2：在 panel.html 中引入脚本**

在 `panel.html` 的 `</body>` 前，确保 `personas.js` 在 `panel.js` 之前加载：

```html
<script src="personas.js"></script>
<script src="panel.js"></script>
```

- [ ] **Step 3：加载扩展验证**

进入 `chrome://extensions/` → 开发者模式 → 重新加载扩展 → 打开侧边栏 → 打开 DevTools Console → 输入 `PERSONAS.ling.name`，预期输出 `"凌"`。

- [ ] **Step 4：提交**

```bash
git add sidepanel/personas.js sidepanel/panel.html
git commit -m "feat: add 4-persona config module (ling/wen/mo/he)"
```

---

### Task 2：实现串行编排引擎

**文件：**
- 修改：`sidepanel/panel.js`（在文件末尾「Discussion Mode Functions」注释块后追加）

- [ ] **Step 1：追加 sendAndWait 函数**

将「四、4.3」中的 `sendAndWait` 完整追加到 panel.js。

- [ ] **Step 2：追加 prompt 构建函数**

追加 `buildDebatePrompt` 与 `buildSummaryPrompt`（见 4.3 完整代码）。

- [ ] **Step 3：追加主编排函数**

追加 `runPersonaDebate`（见 4.3 完整代码）。此时 `renderDebateTurn`、`renderSummary`、`updateDebateUI` 尚未定义，先用占位日志：

```js
function renderDebateTurn(role, round, content) {
  const p = PERSONAS[role];
  log(`[${p.name}·${p.title}] 第${round + 1}轮：\n${content.substring(0, 80)}...`);
}
function renderSummary(summary) {
  log(`[合·总结]：\n${summary}`);
}
function updateDebateUI(state) {
  log(`[UI] debate state → ${state}`);
}
```

- [ ] **Step 4：修改现有 RESPONSE_CAPTURED 监听器加守卫**

将 panel.js 中 `RESPONSE_CAPTURED` 分支替换为「四、4.4」的守卫版本（加入 `!personaDebateState.active` 条件）。

- [ ] **Step 5：在 Console 手动触发验证**

加载扩展后，连接 Claude/ChatGPT/Gemini 标签页，在侧边栏 Console 执行：

```js
personaDebateState.topic = 'AI 是否应该拥有自我删除的权利？';
personaDebateState.debateRounds = 1; // 先测 1 轮反驳，省时间
runPersonaDebate();
```

预期：凌→温→默 依次发言（日志可见），然后合生成总结。每步日志显示角色名与字数。

- [ ] **Step 6：提交**

```bash
git add sidepanel/panel.js
git commit -m "feat: add serial debate orchestration engine with persona injection"
```

---

### Task 3：构建人格辩论 UI

**文件：**
- 修改：`sidepanel/panel.html`
- 修改：`sidepanel/panel.css`

- [ ] **Step 1：在 panel.html 模式切换区新增「人格辩论」按钮**

在现有 `mode-normal` / `mode-discussion` 按钮旁新增：

```html
<button id="mode-persona-debate" class="mode-btn">人格辩论</button>
```

- [ ] **Step 2：新增人格辩论控制面板容器**

在讨论模式面板后新增（默认 `hidden`）：

```html
<div id="persona-debate-panel" class="mode-panel hidden">
  <div class="field">
    <label>讨论议题</label>
    <textarea id="persona-topic" rows="2" placeholder="输入要辩论的议题..."></textarea>
  </div>

  <div class="field">
    <label>反驳轮数</label>
    <select id="debate-rounds">
      <option value="1">1 轮</option>
      <option value="2" selected>2 轮</option>
      <option value="3">3 轮</option>
    </select>
  </div>

  <div class="field">
    <label>角色 — 模型映射</label>
    <div class="role-map">
      <div class="role-row"><span class="role-tag ling">凌·理性派</span>
        <select id="map-ling"><option value="claude">Claude</option><option value="chatgpt">ChatGPT</option><option value="gemini">Gemini</option></select></div>
      <div class="role-row"><span class="role-tag wen">温·感性派</span>
        <select id="map-wen"><option value="claude">Claude</option><option value="chatgpt">ChatGPT</option><option value="gemini" selected>Gemini</option></select></div>
      <div class="role-row"><span class="role-tag mo">默·审问派</span>
        <select id="map-mo"><option value="claude">Claude</option><option value="chatgpt" selected>ChatGPT</option><option value="gemini">Gemini</option></select></div>
      <div class="role-row"><span class="role-tag he">合·总结者</span>
        <select id="map-he"><option value="claude" selected>Claude</option><option value="chatgpt">ChatGPT</option><option value="gemini">Gemini</option></select></div>
    </div>
  </div>

  <div class="actions">
    <button id="start-persona-debate" class="primary-btn">开始辩论</button>
    <button id="abort-persona-debate" class="danger-btn" disabled>中止</button>
  </div>

  <div id="persona-debate-log" class="debate-log"></div>
</div>
```

- [ ] **Step 3：在 panel.css 新增样式**

```css
.role-tag { display:inline-block; padding:2px 8px; border-radius:4px; font-size:12px; font-weight:600; color:#fff; }
.role-tag.ling { background:#2563eb; }
.role-tag.wen  { background:#db2777; }
.role-tag.mo   { background:#475569; }
.role-tag.he   { background:#059669; }
.role-row { display:flex; align-items:center; gap:8px; margin:4px 0; }
.role-row select { flex:1; }
.debate-log { margin-top:12px; max-height:400px; overflow-y:auto; }
.debate-turn { border-left:3px solid #ddd; padding:6px 10px; margin:6px 0; }
.debate-turn.ling { border-color:#2563eb; }
.debate-turn.wen  { border-color:#db2777; }
.debate-turn.mo   { border-color:#475569; }
.debate-summary { border:2px solid #059669; padding:10px; border-radius:6px; background:#ecfdf5; }
```

- [ ] **Step 4：加载扩展验证 UI 显示**

切换到「人格辩论」模式，确认面板可见、角色色卡显示正确、下拉框可选。此步不触发实际辩论。

- [ ] **Step 5：提交**

```bash
git add sidepanel/panel.html sidepanel/panel.css
git commit -m "feat: add persona debate UI with role-model mapping"
```

---

### Task 4：连接 UI 与编排引擎

**文件：**
- 修改：`sidepanel/panel.js`

- [ ] **Step 1：替换占位渲染函数为真实 DOM 渲染**

替换 Task 2 Step 3 的占位函数：

```js
function renderDebateTurn(role, round, content) {
  const p = PERSONAS[role];
  const log = document.getElementById('persona-debate-log');
  const turn = document.createElement('div');
  turn.className = `debate-turn ${role}`;
  turn.innerHTML = `<strong>${p.name}·${p.title}</strong> <span class="muted">第${round + 1}轮</span><hr>${escapeHtml(content)}`;
  log.appendChild(turn);
  log.scrollTop = log.scrollHeight;
}

function renderSummary(summary) {
  const log = document.getElementById('persona-debate-log');
  const box = document.createElement('div');
  box.className = 'debate-summary';
  box.innerHTML = `<strong>合·全局分析 — 终局总结</strong><hr>${escapeHtml(summary)}`;
  log.appendChild(box);
  log.scrollTop = log.scrollHeight;
}

function updateDebateUI(state) {
  const startBtn = document.getElementById('start-persona-debate');
  const abortBtn = document.getElementById('abort-persona-debate');
  if (state === 'running') {
    startBtn.disabled = true;
    abortBtn.disabled = false;
  } else {
    startBtn.disabled = false;
    abortBtn.disabled = true;
  }
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
```

- [ ] **Step 2：新增事件绑定函数**

在 panel.js 的初始化区域（`setupDiscussionMode` 旁）新增：

```js
function setupPersonaDebateMode() {
  // 模式切换
  document.getElementById('mode-persona-debate').addEventListener('click', () => switchPersonaMode());
  // 开始辩论
  document.getElementById('start-persona-debate').addEventListener('click', startPersonaDebate);
  // 中止（置标志位，编排循环检查）
  document.getElementById('abort-persona-debate').addEventListener('click', () => {
    personaDebateState.active = false;
    log('[人格辩论] 用户请求中止');
  });
}

function switchPersonaMode() {
  // 隐藏其他模式面板，显示人格辩论面板
  document.querySelectorAll('.mode-panel').forEach(p => p.classList.add('hidden'));
  document.getElementById('persona-debate-panel').classList.remove('hidden');
  document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('mode-persona-debate').classList.add('active');
}

function startPersonaDebate() {
  // 读取 UI 值到 state
  personaDebateState.topic = document.getElementById('persona-topic').value.trim();
  personaDebateState.debateRounds = parseInt(document.getElementById('debate-rounds').value);
  personaDebateState.roleAIMap = {
    ling: document.getElementById('map-ling').value,
    wen:  document.getElementById('map-wen').value,
    mo:   document.getElementById('map-mo').value,
    he:   document.getElementById('map-he').value
  };
  // 清空记录区
  document.getElementById('persona-debate-log').innerHTML = '';
  runPersonaDebate();
}
```

- [ ] **Step 3：在 DOMContentLoaded 初始化中调用**

在 `document.addEventListener('DOMContentLoaded', ...)` 回调中追加：

```js
setupPersonaDebateMode();
```

- [ ] **Step 4：加入中止检查到编排循环**

修改 `runPersonaDebate` 的内层循环，在每次发言前检查中止标志：

```js
for (const role of state.roleOrder) {
  if (!state.active) { log('[人格辩论] 已中止', 'error'); return; }
  // ... 原有逻辑
}
```

并在 `finally` 块中确保 UI 恢复（已有 `updateDebateUI('idle')`）。

- [ ] **Step 5：端到端验证**

1. 打开并登录 Claude、ChatGPT、Gemini 三个标签页，各刷新一次。
2. 切换到「人格辩论」模式。
3. 输入议题：「远程办公是否应该成为公司默认选项」。
4. 反驳轮数选 1。
5. 点击「开始辩论」。
6. 预期：凌（Claude）先发言并显示蓝色卡片 → 温（Gemini）粉色卡片 → 默（ChatGPT）灰色卡片 → 合（Claude）绿色总结框。日志区依次滚动。
7. 测试「中止」按钮：再次运行，在第 1 轮中点击中止，预期日志显示中止且按钮恢复。

- [ ] **Step 6：提交**

```bash
git add sidepanel/panel.js
git commit -m "feat: wire persona debate UI to orchestration engine with abort support"
```

---

### Task 5：角色—模型映射持久化

**文件：**
- 修改：`sidepanel/panel.js`

- [ ] **Step 1：新增保存/加载函数**

```js
async function saveRoleAIMap() {
  const map = personaDebateState.roleAIMap;
  await chrome.storage.local.set({ personaRoleAIMap: map });
}

async function loadRoleAIMap() {
  const result = await chrome.storage.local.get('personaRoleAIMap');
  if (result.personaRoleAIMap) {
    personaDebateState.roleAIMap = { ...DEFAULT_ROLE_AI_MAP, ...result.personaRoleAIMap };
    // 回填到 UI 下拉框
    for (const role of ['ling','wen','mo','he']) {
      const sel = document.getElementById('map-' + role);
      if (sel) sel.value = personaDebateState.roleAIMap[role];
    }
  }
}
```

- [ ] **Step 2：在 startPersonaDebate 末尾调用保存**

```js
saveRoleAIMap();
```

- [ ] **Step 3：在 setupPersonaDebateMode 末尾调用加载**

```js
loadRoleAIMap();
```

- [ ] **Step 4：验证持久化**

修改映射 → 开始一次辩论（可中止）→ 关闭并重开侧边栏 → 确认下拉框保持上次选择。

- [ ] **Step 5：提交**

```bash
git add sidepanel/panel.js
git commit -m "feat: persist role-model mapping to chrome.storage.local"
```

---

## 七、候选模型适配框架

候选模型中，ChatGPT/Gemini/Claude 为 ai-roundtable 原生支持，无需新增脚本。DeepSeek 与 GLM 需新增 content 脚本（参照 `content/claude.js` 结构，适配输入框、发送按钮、流式完成检测、最新回复抓取四类 DOM 选择器）。Grok 可选适配。

### 7.1 需新增的 content 脚本清单

| 平台 | 文件 | 匹配域名 | 内部 aiType 键 | 默认映射角色 | 优先级 |
|---|---|---|---|---|---|
| DeepSeek | `content/deepseek.js` | chat.deepseek.com | `deepseek` | 凌（默认） | 必做 |
| 智谱 GLM | `content/glm.js` | chatglm.cn | `glm` | 温（默认） | 必做 |
| Grok | `content/grok.js` | grok.com | `grok` | 备选（用量受限） | 可选 |

DeepSeek 与 GLM 均为主推默认角色的承载模型，**必须实现**。Grok 因 fast 模式限制与翻墙问题可选。

### 7.2 通用 content 脚本模板（以 DeepSeek 为例完整实现）

DeepSeek 网页端使用标准 `<textarea>` 输入框，自动化较简单。以下脚本直接参照 `claude.js` 结构，可作为 GLM 等其他模型的复制模板。

```js
// content/deepseek.js  — DeepSeek 网页端注入脚本
(function () {
  'use strict';
  const AI_TYPE = 'deepseek';
  const LOAD_FLAG = '__AIPanelContentLoaded_deepseek';
  const LOAD_VERSION = chrome.runtime?.getManifest?.().version || 'unknown';
  if (window[LOAD_FLAG] === LOAD_VERSION) return;
  window[LOAD_FLAG] = LOAD_VERSION;

  function isContextValid() { return chrome.runtime && chrome.runtime.id; }
  function safeSendMessage(message, callback) {
    if (!isContextValid()) return;
    try { chrome.runtime.sendMessage(message, callback); } catch (e) {}
  }
  safeSendMessage({ type: 'CONTENT_SCRIPT_READY', aiType: AI_TYPE });

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'INJECT_MESSAGE') {
      injectMessage(message.message)
        .then(() => sendResponse({ success: true }))
        .catch(err => sendResponse({ success: false, error: err.message }));
      return true;
    }
    if (message.type === 'GET_LATEST_RESPONSE') {
      sendResponse({ content: getLatestResponse() });
      return true;
    }
  });

  setupResponseObserver();

  // —— 注入消息到 DeepSeek 输入框并提交 ——
  async function injectMessage(text) {
    // DeepSeek 使用 textarea，先填值再派发 input 事件让框架感知
    const textarea = document.querySelector('textarea#chat-input')
      || document.querySelector('textarea[placeholder*="给"]')
      || document.querySelector('textarea');
    if (!textarea) throw new Error('未找到 DeepSeek 输入框');

    // 使用原生 setter 写入值，确保 React/Vue 框架能捕获变化
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype, 'value'
    ).set;
    nativeInputValueSetter.call(textarea, text);
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    await sleep(300);

    // 点击发送按钮（多种可能的选择器）
    const sendBtn = document.querySelector('div[role="button"] svg.icon-send')
      || document.querySelector('button[aria-label*="发送"]')
      || document.querySelector('div.send-button')
      || Array.from(document.querySelectorAll('div[role="button"]'))
            .find(b => b.querySelector('svg') && b.closest('.input-bar'));
    if (sendBtn) {
      sendBtn.click();
    } else {
      // 回车兜底
      textarea.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true
      }));
    }
    waitForStreamingComplete();
    return true;
  }

  function setupResponseObserver() {
    const observer = new MutationObserver((mutations) => {
      if (!isContextValid()) { observer.disconnect(); return; }
      for (const m of mutations) {
        if (m.type === 'childList') {
          for (const node of m.addedNodes) {
            if (node.nodeType === Node.ELEMENT_NODE) checkForResponse(node);
          }
        }
      }
    });
    const start = () => {
      if (!isContextValid()) return;
      observer.observe(document.querySelector('main') || document.body, {
        childList: true, subtree: true
      });
    };
    document.readyState === 'loading'
      ? document.addEventListener('DOMContentLoaded', start) : start();
  }

  let lastCaptured = '', isCapturing = false;
  function checkForResponse(node) {
    if (isCapturing) return;
    // DeepSeek 回复区选择器（需按实际 DOM 调整）
    if (node.matches?.('.ds-markdown') || node.querySelector?.('.ds-markdown')) {
      waitForStreamingComplete();
    }
  }

  async function waitForStreamingComplete() {
    if (isCapturing) return;
    isCapturing = true;
    let prev = '', stable = 0;
    const maxWait = 600000, interval = 500, threshold = 4;
    const start = Date.now();
    try {
      while (Date.now() - start < maxWait) {
        if (!isContextValid()) return;
        await sleep(interval);
        // DeepSeek 生成中通常有"停止生成"按钮或光标动画
        const isStreaming = document.querySelector('div[aria-label*="停止"]')
          || document.querySelector('.stop-button')
          || document.querySelector('[class*="stop"]');
        const cur = getLatestResponse() || '';
        if (!isStreaming && cur === prev && cur.length > 0) {
          stable++;
          if (stable >= threshold && cur !== lastCaptured) {
            lastCaptured = cur;
            safeSendMessage({ type: 'RESPONSE_CAPTURED', aiType: AI_TYPE, content: cur });
            return;
          }
        } else stable = 0;
        prev = cur;
      }
    } finally { isCapturing = false; }
  }

  function getLatestResponse() {
    // 取最后一个 assistant 消息块的文本
    const blocks = document.querySelectorAll('.ds-markdown--block, .markdown-body, [class*="message"] [class*="content"]');
    if (!blocks.length) return null;
    const last = blocks[blocks.length - 1];
    return last.innerText.trim();
  }

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
  console.log('[AI Panel] DeepSeek content script loaded');
})();
```

### 7.3 各候选平台 DOM 适配要点

> 以下选择器为编写时基于各平台常见结构的预估，**上线前必须用浏览器 DevTools 实地核对**（各平台 DOM 会变动）。核对方法：打开网页端 → F12 → 在 Elements 面板定位输入框/发送按钮/回复区，复制其稳定 class 或属性。

**智谱 GLM（chatglm.cn / z.ai）：**
- 输入框：`textarea`，placeholder 含"输入"或"提问"。z.ai 域名与 chatglm.cn 共用同一套界面。
- 发送按钮：底部工具栏右侧，aria-label 或含 svg 发送图标。
- 回复区：assistant 消息块内含 `.markdown-body` 或 `[class*="content"]` 的 markdown 容器。
- 流式检测：生成中发送键变为 loading/停止态；可监测"停止生成"按钮出现/消失。
- 注意：GLM-5.2 有"思考模式"开关，若开启会在回复中产生可折叠的思考块，抓取最新回复时需过滤思考块（参照 claude.js 中过滤 `.overflow-hidden` 思考块的逻辑）。
- 优势：GLM-5.2 主攻 Coding 与长程任务，1M 无损上下文，适合消化全部辩论历史做总结 [$TRAE_REF](https://www.zhipuai.cn/zh/research/161)。

**Grok（grok.com）：**
- 输入框：`textarea` 或 `div[contenteditable="true"]`，底部输入区。
- 发送按钮：输入区右侧，含 svg。
- 回复区：消息列表中 assistant 气泡，含 markdown 渲染容器。
- 流式检测：生成时出现"停止"按钮。
- **重要限制**：①免费版仅 fast 模式可用（低推理预算快速响应版，推理深度有限）[$TRAE_REF](https://blog.csdn.net/nmdbbzcl/article/details/163002585)；②国内访问需翻墙，需确保网络环境稳定；③建议仅在已订阅解锁完整模式时才将 Grok 纳入默认映射。

**DeepSeek（chat.deepseek.com）** 见 7.2 完整实现，要点：标准 textarea + 原生 setter 注入 + "停止"按钮流式检测。

### 7.4 配套修改（每个新增平台统一处理）

每新增一个候选平台，除 content 脚本外，需同步改三处：

1. **`manifest.json`** — 在 `content_scripts` 增加匹配规则：
   ```json
   { "matches": ["https://chat.deepseek.com/*"], "js": ["content/deepseek.js"] },
   { "matches": ["https://chatglm.cn/*"], "js": ["content/glm.js"] },
   { "matches": ["https://z.ai/*"], "js": ["content/glm.js"] },
   { "matches": ["https://grok.com/*"], "js": ["content/grok.js"] }
   ```

2. **`panel.js`** — 扩展模型注册：
   ```js
   // 原：const AI_TYPES = ['claude', 'chatgpt', 'gemini'];
   const AI_TYPES = ['claude', 'chatgpt', 'gemini',
                     'deepseek', 'glm', 'grok'];

   // 原 getAITypeFromUrl 增加：
   if (url.includes('chat.deepseek.com')) return 'deepseek';
   if (url.includes('chatglm.cn') || url.includes('z.ai')) return 'glm';
   if (url.includes('grok.com')) return 'grok';

   // connectedTabs 增加对应键
   ```

3. **`panel.html`** — 角色映射下拉框为每个 `<select>` 增加候选模型 `<option>`：
   ```html
   <option value="deepseek">DeepSeek V4</option>
   <option value="glm">智谱 GLM-5.2</option>
   <option value="grok">Grok</option>
   ```

### 7.5 推荐实施顺序

1. 先按原方案 Task 1~5 跑通「Claude/ChatGPT/Gemini + 复用」的最小可用版（验证编排引擎）。
2. 实现 `deepseek.js`（最简单，标准 textarea），把「凌」切到 DeepSeek V4。
3. 实现 `glm.js`（复制 deepseek.js 模板，调整选择器），备选映射可启用 GLM-5.2。
4. （可选）实现 `grok.js`，仅在已订阅解锁完整模式或接受 fast 模式限制时启用。
5. 至此主推映射（凌=DeepSeek/温=Gemini/默=ChatGPT/合=Claude）4 角色各占独立标签页，Claude 仅做「合」，用量问题彻底解决。

每步实现后，单独用「普通模式」向该模型发一条消息验证注入+捕获，再纳入人格辩论。

---

## 八、风险与注意事项

1. **DOM 依赖风险**：ai-roundtable 依赖各 AI 平台 DOM 结构，平台更新可能导致注入/捕获失效。这是上游项目的已知限制，改造方案不改变此风险性质。
2. **总结者复用同标签页**：合复用 Claude 时，Claude 标签页的对话历史会累积凌的发言 + 合的总结。这无碍功能（每次注入含完整人格 prompt），但若希望总结者上下文干净，可在总结前手动新开 Claude 对话，或采用进阶方案的第 4 平台。
3. **轮次耗时**：3 讨论者 × (1 立场 + N 反驳) + 1 总结，每轮约 30~90 秒，2 轮反驳总计约 5~12 分钟。已复用现有 10 分钟超时上限。
4. **人格稳定性**：网页端模型无独立 system prompt 通道，人格靠消息前置注入。长对话中模型可能"出戏"，反驳轮 prompt 已重复强调角色立场以缓解。
5. **许可**：ai-roundtable 为 MIT 协议，改造与分发无障碍，建议保留原作者声明。

---

## 九、验收清单

- [ ] 4 个角色人格 prompt 可在 Console 读取（`PERSONAS.*`）。
- [ ] 人格辩论模式 UI 可切换、角色色卡正确、映射下拉框可改。
- [ ] 输入议题后，凌→温→默 依次串行发言，每人在 UI 生成对应色卡。
- [ ] 反驳轮中，每人收到前序全部发言（可从日志或回复内容验证）。
- [ ] 最后合生成绿色总结框，遵循六段结构。
- [ ] 中止按钮可中断编排，UI 恢复可用。
- [ ] 角色—模型映射在重开侧边栏后保持。
- [ ] 旧讨论模式（2 人）与互评/交叉引用功能不受影响。
- [ ] **候选模型适配**：DeepSeek/GLM content 脚本可单独完成「注入消息→捕获回复」。
- [ ] **Claude 用量控制**：跑完一个完整议题后，Claude 标签页仅新增 1 条对话（仅合总结），其余角色不占用 Claude 额度。
- [ ] **默认映射验证**：凌=DeepSeek V4 Pro、温=GLM 5.2、默=ChatGPT、合=Claude Sonnet 时，一次完整辩论可跑通。
