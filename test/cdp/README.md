# CDP 诊断通道配置（国内版 Tabbit）

本目录的脚本通过 Chrome DevTools Protocol 直连浏览器，用于真实页面上的
DOM 结构探测与提取器验证（比浏览器插件通道能力强得多：可执行任意 JS）。

## 浏览器信息（2026-09 更新：国际版已卸载，改用国内版 Tabbit）

| 项 | 值 |
|---|---|
| 版本 | 国内版 Tabbit Browser（Chromium 内核） |
| 可执行文件路径 | `C:\Users\david\AppData\Local\Tabbit Browser\Application\Tabbit Browser.exe` |
| 默认 profile | `C:\Users\david\AppData\Local\Tabbit Browser\User Data` |
| 调试端口 | `9223` |
| 快捷方式（已加参数） | 桌面 / 任务栏 / 开始菜单的 `Tabbit Browser.lnk` |
| 追加的参数 | `--remote-debugging-port=9223 --remote-allow-origins=*` |

### 快捷方式位置

```
桌面:       %USERPROFILE%\Desktop\Tabbit Browser.lnk
任务栏:     %APPDATA%\Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar\Tabbit Browser.lnk
开始菜单:   %APPDATA%\Microsoft\Windows\Start Menu\Programs\Tabbit Browser.lnk
```

三个快捷方式都已写入调试参数（2026-09-20）。**修改快捷方式只影响后续启动**——
已经运行的浏览器实例不会获得调试端口，需要退出后重新启动。

### 手动启动（带调试端口）

```
D:\PortableApps\_sys\start-tabbit-debug.bat
```

该脚本用默认 profile 启动（保留登录态），Chromium 会自动恢复上次打开的标签页。

## 验证通道

```bash
curl http://127.0.0.1:9223/json/version        # 应返回浏览器版本信息
curl http://127.0.0.1:9223/json/list            # 列出所有标签页
```

## 运行脚本

脚本用 Windows 侧的 node 执行（WSL 里的 `127.0.0.1` 连不到 Windows 的调试端口）：

```bash
/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe -NoProfile \
  -Command "& 'D:\PortableApps\_sys\node\node.exe' 'D:\repos\ai-roundtable\test\cdp\<script>.mjs'"
```

常用脚本：

- `dump-text.mjs --site=<host>` — 用当前 content script 跑提取，逐行打印结果
- `probe-citations-all.mjs` — 全站引用元素普查
- `probe-empty-md.mjs` — 扫描「innerText 非空但序列化为空」的元素（内容缺失排查利器）
- `diag-*.mjs` — 各类问题定位脚本

## 纪律

操作用户日常浏览器前先告知；优先只读诊断；不强制杀浏览器进程（如需重启以开启
调试端口，应请用户确认或由其自行操作）。
