# ChatGPT Trail Exporter · Userscripts 版

免费 Safari 用户脚本版（0.7.3），不需要 Xcode、苹果开发者会员或临时加载扩展。原 Chrome 版在 `main`，原 Safari 扩展版在 `safari-compat`。

## 安装

1. 安装 [Userscripts](https://apps.apple.com/app/userscripts/id1463298887)，打开一次 App。
2. Safari → 设置 → 扩展 → 启用 Userscripts。
3. 用 Safari 打开 [安装脚本](https://raw.githubusercontent.com/Via-wan/chatgpt-trail-exporter/userscripts/chatgpt-trail-exporter.user.js)。
4. 点击 Safari 工具栏中的 Userscripts 图标，在弹出的安装提示中确认安装。
5. 打开或刷新已登录的 ChatGPT 网页。按 Safari 提示授予 Userscripts 对当前 ChatGPT 网站的访问权限（始终允许此网站）。不必为所有网站授权。
6. 点击 ChatGPT 网页右下角“对话导出”按钮。

如第 4 步没有出现安装提示，将上述脚本保存为 `chatgpt-trail-exporter.user.js`，放入 Userscripts App 设置的脚本目录（可在 App 中查看），再打开 Safari 工具栏中的 Userscripts 弹窗，让它重新加载脚本列表，最后刷新 ChatGPT。

## 使用

- 读取当前窗口，或粘贴一个打不开的 ChatGPT 对话链接后直接读取。
- 保留原有完整树 JSON、当前路径 TXT、Markdown + 图片 ZIP、长对话分页抢救、诊断报告及日期文件命名。
- 勾选导出格式，点击“导出已选格式”；生成完毕后点击“点击保存”。
- 面板收起后仍保留数据和运行中的任务；刷新或关闭此标签会清空未保存结果。切换同一网页内的对话后，必须重新点击读取来更新来源。
- 图片跨域请求不携带 ChatGPT 访问令牌和账号请求头。如果 Safari 或服务端阻止图片跨域下载，ZIP 会记录失败诊断。

## 隐私

仅匹配 `https://chatgpt.com/*` 和 `https://chat.openai.com/*`，无 GM 特权、无远程库、无自动网络读取。只有用户主动读取或导出时才请求原有 ChatGPT 接口和图片下载地址；会话令牌仅在内存中使用，不会由脚本传给其他域名。JSZip 3.10.1 内置在脚本中；[许可证](vendor/JSZIP-LICENSE.md)。用户脚本使用隔离的 content 世界和封闭 Shadow DOM，不对网页公开导出器状态。请只安装你自己信任的脚本。

## 开发

```bash
npm run build:userscript
npm test
```

原扩展源文件保留为生成输入；修改后重新构建 `chatgpt-trail-exporter.user.js`。自动测试用于语法、构建一致性及导出纯逻辑验证，不能替代真实 Safari/Userscripts 与登录网页的端到端测试。本项目不是 OpenAI 官方扩展。
