# Spec: 聚合链路自愈与失败可见化（Aggregation Recovery & Hardening）

Status: implemented (verified by tests + live-page CDP probe; 2026-10-26, integration branch `spec/aggregation-recovery`)
Created: 2026-10-26
Source: 架构审查（improve-codebase-architecture，2026-10-26）+ CDP 实测确诊 + 已实施修复

## Problem Statement

主持人点「聚合」后 ChatGPT 的回复凭空消失——没有错误、没有提示，ChatGPT 就是不在结果里。根因是 ChatGPT 在 2026-10-14 前后把网页端换成了全新的 app shell：所有旧提取锚点（`data-testid`、`data-message-author-role`、语义 class）全部消失，提取器 0 命中。而聚合取数路径又是全扩展唯一**没有**「content script 失活自动重注入」的消息通道，失败后还会静默回退到上一轮存档回复；侧栏拿到空结果后又把无回复的模型**静默剔除**。三个缺陷叠加，使这次改版失效对主持人完全不可见。

同时，主持人长期反馈「加载比较慢」：打开侧栏即触发 13 路并发探活、每路全量枚举一次所有浏览器标签页；AI 回复流式进行期间，每个标签页每秒约 3.25 次全量 DOM 克隆 + Markdown 序列化（捕获循环、分屏轮询各自重算，互不复用）。人格辩论模式还有一个隐藏缺陷：目标模型标签页缺失时，发送失败不会中断当轮，整个辩论挂满 10 分钟超时才报错。

## Solution

三件事：

1. **ChatGPT 提取器换锚 + 回退链**：改用 2026-10 新 DOM 中经 CDP 实测确认的稳定语义锚点（正文容器的显式角色标记、轮次容器的角色后缀键），旧锚点保留为回退。任何一代 DOM 都能提取。
2. **聚合链路自愈 + 失败可见**：聚合取数统一走带「失活重注入」的消息管线；回退到存档回复时必须携带 stale 标记并在侧栏显式标注「上一轮存档」；聚合/汇总剔除无回复模型时逐个报告原因。
3. **去掉两类浪费**：content script 内加「最新回复缓存」（捕获循环是唯一写方，分屏轮询/聚合/汇总等读方在新鲜窗口内零成本复用）；后台 Service Worker 的标签页枚举改为短 TTL 共享快照 + 标签事件主动失效，发送亲和（记住每个模型上一次用的标签页）持久化到会话级存储，SW 休眠重启不再丢失。辩论模式发送失败立即中断当轮，并在开跑前补齐缺失标签页。

## User Stories

1. As a 主持人, I want 聚合时 ChatGPT 的回复能被抓到, so that 同题多答的分歧对比是完整的。
2. As a 主持人, I want 任何模型提取失败时侧栏明确告诉我谁失败、可能为什么, so that 我能区分「还没回答」和「坏了」而不是自己猜。
3. As a 主持人, I want 聚合结果里来自上一轮存档的回复被明确标注, so that 我不会把旧回复当成当前轮的回答做交叉评价。
4. As a 主持人, I want ChatGPT 未来再改版时旧锚点仍可回退提取, so that 单次改版不至于全断。
5. As a 主持人, I want 打开侧栏时状态灯快速点亮, so that 我不用等全量标签页枚举 ×13 遍。
6. As a 主持人, I want 分屏视图在辩论进行中保持流畅, so that 浏览器不因每秒数次的全文序列化而卡顿。
7. As a 主持人, I want 长时间辩论中途每轮仍发到同一个标签页, so that 上下文不因 Service Worker 休眠丢失亲和而错位。
8. As a 主持人, I want 人格辩论里发送失败立刻报错中断, so that 我不用白等 10 分钟超时。
9. As a 主持人, I want 人格辩论开跑前自动补开缺失的模型标签页, so that 与普通群发有一致的自愈体验。
10. As a 主持人, I want 扩展重载后聚合仍然能工作, so that 开发迭代不需要刷新所有 AI 页面才能恢复聚合。
11. As an 扩展维护者, I want 提取器行为有真实 DOM fixture 的回归测试, so that 站点改版时我能离线定位断点而不是在生产里试错。
12. As an 扩展维护者, I want 聚合取数与发送/探活走同一条自愈消息管线, so that 修一处自愈逻辑全部路径受益。
13. As an 扩展维护者, I want 缓存与快照的行为经消息 seam 可测, so that 性能优化不引入正确性回归而无从发现。
14. As an 扩展维护者, I want 新锚点选择器的依据（CDP 实测日期、锚点语义）记录在案, so that 下次改版能快速对照。

## Implementation Decisions

1. **ChatGPT 站点适配器的提取锚点改为有序回退链**，顺序即优先级：新正文容器锚点（`data-markdown-text-style="assistant-message"`，2026-10 codex app-shell 中助手正文容器的显式角色标记）→ 新轮次容器锚点（`data-content-search-unit-key` 以 `:assistant` 结尾，含 UI 噪声由序列化清理剥除）→ 旧版角色属性锚点（`data-message-author-role`）→ 历史 class 兜底。消息容器计数信号（捕获状态机的变更检测用）同步采用同一优先序。来自 CDP 实测（2026-10-26）：新 DOM 中 `data-testid` 全线消失、class 为构建哈希不可用作锚点。
2. **聚合取数路径统一走自愈消息管线**：后台查询最新回复改用与发送/探活/重置相同的「失活即重注入并退避重试」发送函数，消除此前唯一一条裸发送的消息通道。
3. **存档回退必须携带 stale 语义**：后台取数在「无标签页」或「content script 不可达」两种回退场景返回 stale 标记与原因；正常实时路径不带。侧栏聚合/汇总/互评/交叉引用/插话统一消费「带 stale 语义的最新回复」返回形状，stale 项在日志与聚合渲染中显式标注「上一轮存档」。
4. **聚合/汇总的剔除可见化**：无回复模型被剔除时逐个输出日志（未回答/页面未开/提取器失效），不再静默过滤。
5. **content script 内最新回复缓存**（seam：content script 的消息接口）：捕获循环的每次 tick 与发送前快照是缓存的唯一写方（它们必须现算以检测变更）；读方（GET_LATEST_RESPONSE：分屏轮询、聚合、汇总、互评）在新鲜窗口（默认 1 秒，覆盖分屏 800ms 轮询对 500ms tick 刷新的相位差）内直接返回缓存，过期现算一次并刷新。新鲜窗口经配置项可调，供测试注入。
6. **后台标签枚举共享短 TTL 快照**（250ms）：13 路并发探活与分屏周期轮询在窗口内共享一次枚举结果；标签页更新/关闭事件立即失效快照。逐模型评分每次调用仍对新数据运行。
7. **发送亲和持久化到会话级存储**（chrome.storage.session）：内存映射 + 写透 + SW 启动时恢复；存储不可用时退化为纯内存（SW 休眠即丢，与现状持平）。
8. **辩论编排快失败与前置补齐**：发送函数以「resolve 而非 reject」表达失败，编排层在收到失败结果时立即中断当轮并报错（此前会挂满 620 秒超时）；人格辩论启动前先执行与普通群发相同的标签页补齐流程；文件上传分支复用同一份去重后的模型清单。
9. 侧栏聚合结果条目的 stale 标注通过轻量样式呈现（警示色小标），不影响纯文本复制的格式（复制内容保持既有纯函数行为与既有测试不变）。

## Testing Decisions

好测试只测外部行为：全部经消息 seam 或纯函数驱动，不检查内部状态。使用的 seams（全部为现有 seam，无新增）：

- **content script 消息 seam**（GET_LATEST_RESPONSE / PING）：在 vm 沙箱加载真实的 dom-utils → base → 站点适配器三层栈，配 fake DOM（按 CDP 实测形态构造），从监听器入口驱动——与后台调用方穿同一个接口。
- **后台消息路由 seam**（handleMessage）：vm 沙箱 + stub 的 chrome API（tabs/storage/scripting），经消息类型驱动。
- **纯函数 seam**：聚合纯文本格式化（既有测试保持不变）。

被测 modules 与用例：

- ChatGPT 站点适配器提取器：三个 fixture——新 DOM（用户轮次 + 助手轮次 + 表格，断言取助手正文、表格转管道行、用户文本不泄漏）、旧 DOM（旧锚点回退仍可用、用户消息不泄漏）、两代并存（新锚点优先）。
- content script 基座的最新回复缓存：计数提取器 + 消息 seam——冷读现算一次；新鲜窗口内连续读零重算；过期后重算一次并取到变更内容；空回复以 null 语义返回。
- 后台取数：无标签页 → stale + 原因；content script 死亡 → 断言发生了重注入（此前回归点）后 stale 回退；正常路径 → 实时内容且不带 stale。
- 后台标签查找：快照共享（窗口内多次查找只枚举一次，失效后重新枚举）；发送亲和写入会话级存储。

Prior art（沿用既有模式）：kimi/glm 聚合测试（fake DOM + 真序列化器 + 站点适配器配置捕获）、后台 tab 打分测试（vm 沙箱 + stub chrome）、捕获状态机测试（base 的 _test 暴露）。chatgpt 测试较 kimi/glm 更进一步：加载完整三层真实栈并从消息 seam 驱动，而非只调适配器配置里的提取函数。

## Out of Scope

- 发送通道收敛为单一 deep module（4 种机制藏进一个接口）与文件注入 12 份站点拷贝的收敛——改动面在事故高发区，待回归网铺开后另立 spec。
- 提取器 fixture 回归网的全站铺开（13 站各存 HTML fixture）——本次仅落 ChatGPT 第一块作为模式样板。
- 新站接入的「一处声明」收敛。
- 用 MutationObserver 增量捕获替代轮询；chatgpt.com 长对话虚拟化（滚动外轮次被卸载）的同源 API 取数回退。
- ChatGPT 流式信号（stop 按钮语义）在新 DOM 的适配——当前由稳定窗口与兜底强捕获路径兜住，待实测一轮流式对话后再决定是否需要新锚点。

## Further Notes

- 确诊证据链：CDP 9223 实测（2026-10-26，chatgpt.com 会话页）——`[data-message-author-role]`、`[data-testid*="conversation-turn"]`、`.markdown`、`article` 全部 0 命中；正文容器祖先链带 `data-markdown-text-style="assistant-message"` 与 `data-content-search-unit-key="…:assistant"`。时间线与 Reddit r/ChatGPT 2026-10-14「ChatGPT changed its HTML structure and broke some extensions」社区报告吻合。
- 新锚点同样可能随下次改版消失：回退链保证退化而非全断，失败可见化保证下次失效当天可见而非数周后。
- 待真机实测项（测试环境无法替代）：重载扩展后真实聚合一轮 ChatGPT；流式进行中分屏轮询的流畅度主观对比。
- 关联背景：本次同时消除了三个性能浪费点（13×N 标签枚举、每秒 3.25 次全量序列化、SW 休眠丢亲和），分别对应「打开侧栏慢」「辩论中卡」「多标签选错」三类主持人感知。

## Comments

**2026-10-26 · 实现完成与验证记录**（integration branch `spec/aggregation-recovery`）

- 9 条 Implementation Decisions 全部落地：ChatGPT 站点适配器锚点回退链与计数信号、后台取数自愈管线 + stale 语义、content script 最新回复缓存、标签枚举共享快照 + 事件失效、亲和写透/启动恢复会话级存储、辩论快失败与前置补齐、五条取数路径（聚合/汇总/互评/交叉引用/插话）统一 stale 消费与剔除可见化、聚合条目存档标注样式。
- 测试：`npm test` 11 个文件全部通过。新增 `test/chatgpt-aggregation.test.js`（真实三层栈 + 消息 seam，三 fixture：codex shell / 旧 DOM / 两代并存优先级）、`test/reply-cache.test.js`（冷读/新鲜窗零重算/过期重算/null 语义）、`test/get-response.test.js`（重注入计数 / no-tab stale / live 无 stale）；扩展 `test/background-score.test.js`（快照共享一次枚举、失效强制刷新、亲和写入与 SW 重启恢复）。纯文本格式化函数与既有测试保持不变（D9）。
- 真实页面验证：CDP 9223 在 chatgpt.com 会话页执行与修复后提取器相同的选择器链——第一个新锚点命中，提取 10849 字符完整正文，无用户消息泄漏。
- Code review 修复三处：后台标签事件失效收窄到评分相关字段（避免 title 噪声打穿快照）、末尾过时注释更新、插话路径补 stale 提示（对齐 D3 五路径一致）。
- 待真机实测（沙箱无法替代）：`chrome://extensions` 重载扩展后真机点一次「聚合」做端到端确认。
