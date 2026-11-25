# ChatGPT Trail Exporter · 对话足迹导出

一个轻量、开源、本地运行的 ChatGPT 对话导出工具。保留完整对话分支树，支持 JSON、Markdown（含图片）、TXT 及长窗口抢救，而不只是复制当前屏幕上的聊天文字。

> 本项目由 [Via-wan](https://github.com/Via-wan) 开源维护，不是 OpenAI 官方扩展。项目依赖 ChatGPT 网页内部接口；页面或接口更新后，部分功能可能需要同步适配。

## 选择你的浏览器

三种版本均免费、独立维护；按需选择一种安装即可。

| 浏览器 / 方式 | 安装入口 | 说明 |
| --- | --- | --- |
| Chrome（原生扩展） | [下载 ZIP](https://github.com/Via-wan/chatgpt-trail-exporter/archive/refs/heads/main.zip) | `main` · v0.7.1，支持浏览器原生侧栏 |
| **Safari（推荐：Userscripts）** | [安装脚本](https://raw.githubusercontent.com/Via-wan/chatgpt-trail-exporter/userscripts/chatgpt-trail-exporter.user.js) · [使用说明](https://github.com/Via-wan/chatgpt-trail-exporter/tree/userscripts) | `userscripts` · v0.7.3，免费、无需 Xcode 或开发者会员，网页内悬浮导出面板 |
| Safari（原生扩展） | [下载 ZIP](https://github.com/Via-wan/chatgpt-trail-exporter/archive/refs/heads/safari-compat.zip) · [安装说明](https://github.com/Via-wan/chatgpt-trail-exporter/tree/safari-compat) | `safari-compat` · v0.7.2，独立导出页，未签名扩展受 Safari 安装限制 |

Safari 日常自用优先选择 Userscripts 版：安装后无需反复加载临时扩展。原生 Safari 版供希望使用独立扩展的用户选择。

## 功能

- 从当前 ChatGPT 对话页读取原始 conversation JSON。
- 完整保留 `mapping`、`current_node`、`parent`、`children` 和全部分支。
- 下载原始 JSON、当前路径 Markdown + 图片、当前路径 TXT、结构诊断报告。
- JSON / Markdown / TXT 可复选；选择多种格式时打包进同名文件夹与 ZIP，一次下载完成。
- 自动以 `标题（起始日期~结束日期）` 命名，结束日期取当前路径最后一条可见消息，方便重复备份。
- 浏览器刚启动、页面会话尚未准备好时，会自动重试页面连接；不会把 429 或 500 当成连接问题反复请求。
- 可从任意正常 ChatGPT 页面粘贴另一个对话链接，绕过超长窗口的页面渲染直接导出。
- 若完整对话树接口返回 500，自动以逐级缩小的分页请求抢救当前路径，并在界面、JSON 和诊断报告中标注。
- 若会话本身解析超时，先从聊天搜索结果取得末端消息 ID，再进行定向分页，避免服务器重新遍历整棵树。
- 若定向分页入口仍超时，最后尝试把消息 ID 直接作为 `/messages` 游标读取；此模式可能缺少游标本身及之后的消息，因此始终标记为“路径片段”。
- 代读项目内对话时，会从历史/搜索结果识别目标项目，并按 ChatGPT 当前网页端的方式补上账号与项目请求上下文后重试完整树和分页接口。
- 读取最终失败时可下载完整失败诊断，包含每条请求的策略、耗时、状态、锚点、分页大小及是否带入账号/项目上下文。
- 检查父子断链、节点 ID 不一致、缺失当前节点等结构问题。
- 所有内容仅在当前浏览器中读取和下载，不发送到第三方服务器。
- Chrome 版可把导出器固定到当前 ChatGPT 标签专属的浏览器侧栏。
- Chrome 侧栏切换标签时自动隐藏并恢复；Safari 原生版提供独立导出页，Userscripts 版提供网页内可收起的悬浮面板。

## 安装

### Chrome（原生扩展）

1. 下载上方 Chrome 版 ZIP 并解压。
2. 在 Chrome 地址栏打开 `chrome://extensions`。
3. 开启右上角“开发者模式”。
4. 点击“加载已解压的扩展程序”。
5. 选择包含 `manifest.json` 的 `chatgpt-trail-exporter` 文件夹。
6. 打开一个 ChatGPT 对话，点击浏览器工具栏中的扩展图标。

### Safari（推荐：Userscripts）

1. 在 App Store 免费安装 [Userscripts](https://apps.apple.com/app/userscripts/id1463298887)，打开一次 App；如提示选择脚本存放目录，先完成设置。
2. 在 Safari → 设置 → 扩展中启用 Userscripts。
3. 用 Safari 打开 [ChatGPT Trail Exporter 安装脚本](https://raw.githubusercontent.com/Via-wan/chatgpt-trail-exporter/userscripts/chatgpt-trail-exporter.user.js)。页面显示大量 JavaScript 源码是正常现象，不是安装失败。
4. 点击 Safari 工具栏中的 Userscripts 图标，再点击黄色提示 **Userscript Detected: Click to install**，确认安装。
5. 打开或刷新已登录的 ChatGPT 网页。若右下角未出现按钮，点击工具栏的 Userscripts 图标，根据提示允许访问当前网站。
6. 为常用 ChatGPT 域名选择“始终允许”，避免每个新标签页都要重新授权。也可以在 Safari → 设置 → 扩展 → Userscripts 的网站访问设置中检查相应权限（菜单名称因系统版本而异）。
7. 网页右下角出现“对话导出”后，点击即可使用；生成文件后，再点击面板内的保存链接。

**普通对话或 Work 窗口没有显示按钮？** 先检查实际网址是否属于 `chatgpt.com` 或 `chat.openai.com`，并确认对应网站已授予 Userscripts 访问权限。若当前页面仍需要授权，点击工具栏的 Userscripts 图标并授权后再刷新。无需重复安装脚本。面板出现仅表示脚本界面正常加载，不代表所有对话类型及导出接口均已验证。

更多说明与手动安装方法见 [Userscripts 版 README](https://github.com/Via-wan/chatgpt-trail-exporter/tree/userscripts)。

### Safari（原生扩展，可选）

请阅读 [Safari 原生扩展分支的安装说明](https://github.com/Via-wan/chatgpt-trail-exporter/tree/safari-compat)。本项目没有签名的 macOS App 或 App Store 原生扩展发行包；临时扩展会受 Safari 的移除规则限制。

## 使用

1. 打开对应版本的导出面板，点击“读取当前窗口”。长对话导出时，Chrome 可使用侧栏，Safari 原生版可使用独立导出页，Userscripts 版可收起面板；请保持来源页面开启。
2. 等待结构诊断完成。
3. 勾选需要的格式并点击“导出已选格式”：
   - `JSON`：正式备份，保留全部分支。
   - `Markdown`：当前路径的可读文本与沿途图片；Markdown 使用相对路径引用 `images` 文件夹。
   - `TXT`：当前路径的纯文本版本，保留角色、时间、正文与分支点提示。
4. 只选择 JSON 或 TXT 时直接下载对应文件；只选择 Markdown 时下载 MD 与图片 ZIP；选择两种或三种时下载 `标题（起始日期~结束日期）.zip`，内容放在同名文件夹中。
5. Chrome 版直接下载；Safari 两种版本在文件生成后点击“点击保存”。
6. `诊断报告`：另行下载节点、分支和断链统计。

### 固定到浏览器侧栏（Chrome）

1. 在一个正常的 ChatGPT 标签页点击扩展图标。
2. 点击“固定到侧栏”。插件会在这个标签页右侧打开浏览器原生侧栏。
3. 切到其他 GPT 对话时侧栏自动隐藏；切回原标签时会恢复，并保留原来的读取与导出状态。
4. 若要在另一个 GPT 对话使用侧栏，请在那个标签页重新点击插件并固定。

### 抢救打不开的长窗口

1. 当前标签打开任意能够正常显示的 ChatGPT 页面。
2. 在“打不开的窗口”输入框粘贴目标对话的 `/c/…` 链接。
3. 点击“直接读取”。插件只使用目标 conversation ID 请求数据，不会打开或渲染目标窗口。
4. 若显示“分页抢救成功”，导出包含当前路径，但不保证包含接口未返回的隐藏分支。

## 权限与隐私

以下为 Chrome 原生扩展的权限；Safari 原生版不使用 `sidePanel`，Userscripts 版仅匹配两个 ChatGPT 域名，不要求 GM 特权或额外远程依赖。所有版本均在用户主动读取或导出时处理数据。

- `activeTab`：仅在用户点击扩展时临时访问当前标签页。
- `scripting`：在当前 ChatGPT 页面内执行同源读取。
- `sidePanel`：把导出器显示在 Chrome 浏览器原生侧栏。
- `chatgpt.com` / `chat.openai.com` 站点权限：保证侧栏切换标签或来源标签刷新后仍能继续读取；不访问其他网站。

扩展不申请浏览历史、Cookie、全站访问或第三方服务器权限。

更完整的说明见 [PRIVACY.md](PRIVACY.md)。

## 已知限制

- ChatGPT 的内部 conversation 接口不是公开 API，未来页面更新可能需要同步调整读取逻辑。
- 分页抢救模式只能保证当前路径；只有“树结构：完整”的原始 JSON 才是完整分支备份。
- 读取操作需要当前标签位于 `chatgpt.com` 或旧域名 `chat.openai.com`；手动目标必须是可访问的具体对话。
- Markdown 与 TXT 只导出当前路径；其他分支仍完整保存在原始 JSON 中。
- 若个别图片的临时下载地址失效，ZIP 内会附带 `图片下载失败.json` 供诊断。
- 对需要对话上下文授权的旧上传图片，会按 ChatGPT 网页端的参数重新请求。
- 若对话里的旧文件 ID 已失效，会通过 `library_file_id` 找到当前有效版本后再下载。
- 若 Library 仍保留记录但原图权限已经失效，会用 Library 预览图补位，并在 ZIP 中单独列出。

## 开发与测试

需要 Node.js 20 或更新版本：

```bash
npm test
```

测试覆盖当前路径 TXT、Markdown 范围标记和日期文件名。Safari 和 Userscripts 分支另有对应兼容性测试；Userscripts 已验证安装与面板显示，完整读取、图片和 ZIP 下载仍需在真实 Safari 登录环境中继续验证。

## 开源许可

项目代码采用 [MIT License](LICENSE)。内置 JSZip 保留其原始许可证，见
[`vendor/JSZIP-LICENSE.md`](vendor/JSZIP-LICENSE.md)。

版本变化见 [CHANGELOG.md](CHANGELOG.md)；不同浏览器版本的代码及说明见上方分支入口。
