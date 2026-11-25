# ChatGPT Trail Exporter

一个只处理当前 ChatGPT 对话的轻量浏览器扩展。本分支是 macOS Safari 兼容版（0.7.2）；原 Chrome 版本继续保留在 `main`。

> 本项目由 [Via-wan](https://github.com/Via-wan) 开源维护，不是 OpenAI 官方扩展。项目依赖 ChatGPT 网页内部接口；页面或接口更新后，部分功能可能需要同步适配。

如果只是希望在 Safari 中免费、长期使用导出器，建议直接使用 [Userscripts 版](https://github.com/Via-wan/chatgpt-trail-exporter/tree/userscripts)，无需 Xcode 或临时扩展；[安装脚本](https://raw.githubusercontent.com/Via-wan/chatgpt-trail-exporter/userscripts/chatgpt-trail-exporter.user.js)。本分支保留原生 Safari 扩展方案。

## 功能

- 从当前 ChatGPT 对话页读取原始 conversation JSON。
- 完整保留 `mapping`、`current_node`、`parent`、`children` 和全部分支。
- 下载原始 JSON、当前路径 Markdown + 图片、当前路径 TXT、结构诊断报告。
- JSON / Markdown / TXT 可复选；选择多种格式时打包进同名文件夹与 ZIP，一次下载完成。
- 自动以 `标题（起始日期~结束日期）` 命名，方便重复备份。
- 浏览器刚启动、页面会话尚未准备好时，会自动重试页面连接；不会把 429 或 500 当成连接问题反复请求。
- 可从任意正常 ChatGPT 页面粘贴另一个对话链接，绕过超长窗口的页面渲染直接导出。
- 若完整对话树接口返回 500，自动以逐级缩小的分页请求抢救当前路径，并在界面、JSON 和诊断报告中标注。
- 若会话本身解析超时，先从聊天搜索结果取得末端消息 ID，再进行定向分页，避免服务器重新遍历整棵树。
- 若定向分页入口仍超时，最后尝试把消息 ID 直接作为 `/messages` 游标读取；此模式可能缺少游标本身及之后的消息，因此始终标记为“路径片段”。
- 代读项目内对话时，会从历史/搜索结果识别目标项目，并按 ChatGPT 当前网页端的方式补上账号与项目请求上下文后重试完整树和分页接口。
- 读取最终失败时可下载完整失败诊断，包含每条请求的策略、耗时、状态、锚点、分页大小及是否带入账号/项目上下文。
- 检查父子断链、节点 ID 不一致、缺失当前节点等结构问题。
- 所有内容仅在当前浏览器中读取和下载，不发送到第三方服务器。
- 可打开绑定来源 ChatGPT 标签的独立导出页；长对话和图片打包不依赖工具栏弹窗保持开启。

## Safari 安装（macOS）

### 直接临时安装（若 Safari 提供此功能）

1. 下载本分支 ZIP 并解压；定位到包含 `manifest.json` 的文件夹。
2. Safari 浏览器 → 设置 → 高级，勾选“显示网页开发者功能”。
3. 设置 → 开发者 → 添加临时扩展（Add Temporary Extension），允许未签名扩展，然后选中上面的文件夹。
4. 设置 → 扩展，启用 ChatGPT Trail Exporter (Safari)。
5. 打开已登录的 ChatGPT 页面，点击扩展图标；在 Safari 网站权限提示中仅为当前 ChatGPT 网站选择“始终允许”。

Apple 说明：临时扩展会在退出 Safari 或 24 小时后被移除。若没有“添加临时扩展”按钮，可用下述 Xcode 方式。

### Xcode 本地安装（可反复使用）

1. 从 Mac App Store 安装 Xcode 并完成首次启动。
2. 在终端中执行（将路径替换成实际解压后的目录）：

```bash
xcrun safari-web-extension-packager "/path/to/chatgpt-trail-exporter-safari-compat" --macos-only
```

旧版本 Xcode 的命令名是 `safari-web-extension-converter`，其余参数相同。
3. 打开生成的 Xcode 项目，选择 macOS App target；必要时选择 Sign to Run Locally，然后点击 Run。
4. 如未使用开发者证书，按 Safari 的开发者设置允许未签名扩展，并在扩展设置中启用。退出 Safari 后可能需重新允许。
5. 本分支没有签名的 macOS App 或 App Store 发行包。

官方文档：[运行扩展](https://developer.apple.com/documentation/safariservices/running-your-safari-web-extension) · [打包扩展](https://developer.apple.com/documentation/safariservices/packaging-a-web-extension-for-safari)。

## 使用

1. 在 ChatGPT 标签点击扩展图标。短对话可直接点击“读取当前窗口”；长对话或含图片的导出建议先点击“打开独立导出页”，再点击“读取此窗口”。
2. 等待结构诊断完成。
3. 勾选需要的格式并点击“导出已选格式”：
   - `JSON`：正式备份，保留全部分支。
   - `Markdown`：当前路径的可读文本与沿途图片；Markdown 使用相对路径引用 `images` 文件夹。
   - `TXT`：当前路径的纯文本版本，保留角色、时间、正文与分支点提示。
4. 只选择 JSON 或 TXT 时直接下载对应文件；只选择 Markdown 时下载 MD 与图片 ZIP；选择两种或三种时下载 `标题（起始日期~结束日期）.zip`，内容放在同名文件夹中。
5. 文件生成后，点击出现的“点击保存：文件名”链接，正式交由 Safari 下载。诊断报告也按此方式保存。不要在保存前关闭或刷新导出页。

### 独立导出页

Safari 版不使用 Chrome 的原生侧栏 API。独立导出页通过浏览器标签 ID 绑定打开它时的 ChatGPT 来源标签；切换标签不会关闭导出页。“切回来源”可返回来源页。不要关闭来源标签，否则无法继续读取对话及图片。

### 抢救打不开的长窗口

1. 当前标签打开任意能够正常显示的 ChatGPT 页面。
2. 在“打不开的窗口”输入框粘贴目标对话的 `/c/…` 链接。
3. 点击“直接读取”。插件只使用目标 conversation ID 请求数据，不会打开或渲染目标窗口。
4. 若显示“分页抢救成功”，导出包含当前路径，但不保证包含接口未返回的隐藏分支。

## 权限

- `activeTab`：仅在用户点击扩展时临时访问当前标签页。
- `scripting`：在当前 ChatGPT 页面内执行同源读取。
- `chatgpt.com` / `chat.openai.com` 站点权限：允许独立导出页读取绑定的来源标签；不访问其他网站。Safari 需要用户为相应站点授权。

扩展不申请浏览历史、Cookie、全站访问或第三方服务器权限。

更完整的说明见 [PRIVACY.md](PRIVACY.md)。

## 已知限制

- Safari 兼容代码已根据公开 WebExtensions API 适配；仍需在真实 macOS Safari 和登录的 ChatGPT 页面上进行端到端验证。临时安装与下载行为随 Safari 版本和用户网站权限而异。
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

测试覆盖当前路径 TXT、Markdown 范围标记和日期文件名，以及 Safari manifest、来源标签绑定、注入返回值、显式保存链接的逻辑；不代替真实 Safari 端到端测试。

## 开源许可

项目代码采用 [MIT License](LICENSE)。内置 JSZip 保留其原始许可证，见
[`vendor/JSZIP-LICENSE.md`](vendor/JSZIP-LICENSE.md)。

版本变化见 [CHANGELOG.md](CHANGELOG.md)。
