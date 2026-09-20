# ai-roundtable `test/cdp/` — 扩展侧 CDP 诊断脚本

> **通道配置（浏览器路径 / 端口 / 快捷方式 / 纪律）的权威文档在 aurora 仓库**:
> `docs/CDP_BROWSER_DEBUG.md`(三通道 + 资产地图)、`scripts/cdp/README.md`(核心桥与
> 抓取脚本分工)。本目录**不复制**通道配置,避免多仓漂移。

本目录的脚本用途：**在本扩展的 content script 层面做真实页面验证**——把
`content/*.js` 注入真实 AI 站点页面执行,逐行打印提取结果,用于排查聚合 /
发送 / 引用等线上问题(不同于 aurora 的"网页逆向抓包"定位)。

## 运行方式

用 **Windows 侧 node** 执行(WSL 的 `127.0.0.1` 连不到 Windows 回环上的调试端口):

```bash
/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe -NoProfile \
  -Command "& 'D:\PortableApps\_sys\node\node.exe' 'D:\repos\ai-roundtable\test\cdp\<script>.mjs'"
```

依赖 `cdp-helper.mjs` 的多仓库权威源:`D:\repos\aurora\scripts\cdp\cdp-helper.mjs`。

## 常用脚本

| 脚本 | 用途 |
|---|---|
| `dump-text.mjs --site=<host>` | 跑当前 content script 提取,逐行打印(内容/结构问题首选) |
| `probe-citations-all.mjs` | 全站引用元素普查(引用链路排查) |
| `probe-empty-md.mjs` | 扫描「innerText 非空但序列化为空」的元素(内容缺失利器) |
| `diag-*.mjs` | 各类问题的定位脚本(双标签、输入叠加、隐身对话等) |
| `check-gpt-*.mjs` / `gpt-*.mjs` | ChatGPT 自定义指令设置与群发验证 |
| `multiline-lab.mjs` / `kimi-*.mjs` / `doubao-*.mjs` | 写入/发送链路实验 |

## 约定

- 源码注入一律用**普通字符串拼接**,不要用模板字面量(源码里的反引号会终止模板)。
- 产物(`*.txt` 抓取输出)按 aurora 规则落 `aurora/_scratch/`,不进本目录。
