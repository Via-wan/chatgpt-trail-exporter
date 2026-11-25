import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

function buildUserscript(src) {
  const replace=(s,a,b)=>{if(!s.includes(a))throw Error("Expected source missing: "+a.slice(0,100));return s.replace(a,b)};
  const range=(s,a,b,newContent)=>{const start=s.indexOf(a),end=s.indexOf(b,start);if(start<0||end<0)throw Error("Expected source range missing: "+a);return s.slice(0,start)+newContent+s.slice(end)};
  let html=src["popup.html"].match(/<main>[\s\S]*?<\/main>/)[0];
  html=html.replace(/\s*<section id="source-panel"[\s\S]*?<\/section>/,"");
  html=replace(html,'<button id="fixed-window-button" type="button">打开独立导出页</button>','<button id="close-button" type="button">收起</button>');
  html=replace(html,"读取当前 ChatGPT 窗口，保留完整分支树。长对话或带图片导出，建议先打开独立导出页。","读取当前 ChatGPT 对话，保留完整分支树。可收起面板，但请勿刷新或关闭本网页。");
  html=html.replaceAll("当前标签停在任意正常的 ChatGPT 页面即可","当前标签停在任意正常的 ChatGPT 页面即可");
  let css=src["popup.css"].replace(":root {",":host {").replaceAll("body.side-panel-mode"," .trail-panel").replaceAll("body.workspace-mode main",".trail-panel main").replaceAll(".workspace-mode .primary-actions",".unused-workspace .primary-actions").replace(/\nbody \{/, "\n.trail-panel {");
  css+=`
:host { all: initial; position: fixed; bottom: 22px; right: 22px; z-index: 2147483646; color-scheme: light; font-family: Inter, "PingFang SC", system-ui, sans-serif; color: #25231f; }
.trail-toggle { display: block; margin-left: auto; padding: 10px 15px; border: 1px solid #53695a; border-radius: 999px; background: #53695a; color: white; font-size: 13px; line-height: 1.3; box-shadow: 0 3px 14px #0003; }
.trail-toggle:hover { background: #465b4d; border-color: #465b4d; color: white; }
.trail-panel { width: min(440px, calc(100vw - 44px)); min-height: 0; max-height: calc(100dvh - 92px); max-height: min(760px, calc(100vh - 92px)); overflow: auto; margin-bottom: 10px; border: 1px solid #c9c3b8; border-radius: 16px; box-shadow: 0 8px 32px #0003; color: #25231f; font-family: Inter, "PingFang SC", system-ui, sans-serif; line-height: 1.4; }
.trail-panel.hidden { display: none; }
.trail-panel main { max-width: none; padding: 18px; }
.trail-panel h1 { line-height: 1.25; }
.trail-panel button:focus-visible, .trail-panel a:focus-visible, .trail-toggle:focus-visible { outline: 2px solid #53695a; outline-offset: 2px; }
`;
  let p=src["popup.js"].replace(/^import\s*\{[\s\S]*?\}\s*from\s*"\.\/lib\/conversation\.js";\s*/,"");
  p=replace(p,"const extensionAPI = globalThis.browser ?? globalThis.chrome;\n\n","");
  p=p.replace(/^const (fixedWindowButton|intro|sourcePanel|sourceTitle|sourceUrl|focusSourceButton) = .*;\n/gm,"");
  p=p.replace(/^let (activeChatTabId|workspaceSourceTabId) = .*;\n/gm,"").replace(/^const workspaceMode = .*;\n/m,"");
  p=replace(p,"let failureReport = null;","let failureReport = null;\nlet busy = false;\nlet inMemoryCooldown = 0;");
  p=range(p,"if (workspaceMode) {","function setStatus(","");
  p=p.replaceAll("document.querySelector(","root.querySelector(");
  p=replace(p,"async function executeConversationReadWithRetry(tabId, args) {","async function executeConversationReadWithRetry(args) {");
  p=replace(p,`      const injection = await extensionAPI.scripting.executeScript({
        target: { tabId },
        world: "MAIN",
        func: fetchConversationFromPage,
        args
      });
      lastResult = mainFrameResult(injection);`,`      lastResult = await fetchConversationFromPage(...args);`);
  p=range(p,"function cooldownRemainingSeconds() {","function cooldownLabel(",`function cooldownRemainingSeconds() {
  let retryAt = inMemoryCooldown;
  try { retryAt = Math.max(retryAt, Number(localStorage.getItem(RATE_LIMIT_COOLDOWN_KEY)) || 0); } catch {}
  const remaining = Math.ceil((retryAt - Date.now()) / 1000);
  if (remaining <= 0) {
    inMemoryCooldown = 0;
    try { localStorage.removeItem(RATE_LIMIT_COOLDOWN_KEY); } catch {}
    return 0;
  }
  return remaining;
}

function setCooldown(seconds) {
  inMemoryCooldown = Date.now() + seconds * 1000;
  try { localStorage.setItem(RATE_LIMIT_COOLDOWN_KEY, String(inMemoryCooldown)); } catch {}
}

`);
  p=range(p,"function assertChatGPTPage(","async function fetchConversationFromPage(","");
  p=replace(p,"async function readConversation(reference = null) {\n  const cooldownSeconds","async function readConversation(reference = null) {\n  if (busy) return;\n  const cooldownSeconds");
  p=replace(p,"  clearPreparedDownload();\n  readButton.disabled = true;","  busy = true;\n  clearPreparedDownload();\n  readButton.disabled = true;");
  p=p.replaceAll("  fixedWindowButton.disabled = true;\n","").replaceAll("  activeChatTabId = null;\n","");
  p=replace(p,`    workspaceMode
      ? "正在读取完整对话树；可以切换到其他窗口。"
      : "正在读取完整对话树，请保持弹窗开启…"
`,`    "正在读取完整对话树；可收起面板，请勿刷新或关闭此标签…"
`);
  p=replace(p,`    const tab = await getSourceChatTab();
    assertChatGPTPage(tab.url);
    const conversationReferenceValue = reference ?? tab.url;`,`    const conversationReferenceValue = reference ?? location.href;`);
  p=replace(p,`    activeChatTabId = tab.id;
    const result = await executeConversationReadWithRetry(tab.id, [`,`    const result = await executeConversationReadWithRetry([`);
  p=replace(p,`        localStorage.setItem(
          RATE_LIMIT_COOLDOWN_KEY,
          String(Date.now() + retrySeconds * 1000)
        );`,`        setCooldown(retrySeconds);`);
  p=replace(p,`    const sourceMissing = workspaceMode && workspaceSourceTabId === null;
    readButton.disabled = sourceMissing;
    readLinkButton.disabled = sourceMissing;
    fixedWindowButton.disabled = false;
    conversationReference.disabled = false;`,`    busy = false;
    readButton.disabled = false;
    readLinkButton.disabled = false;
    conversationReference.disabled = false;`);
  p=replace(p,`    const injection = await extensionAPI.scripting.executeScript({
      target: { tabId: activeChatTabId },
      world: "MAIN",
      func: fetchFilesFromPage,
      args: [
        images.map(({ fileId, libraryFileId }) => ({
          fileId,
          libraryFileId
        })),
        conversation.conversation_id
      ]
    });
    downloadedImages = mainFrameResult(injection);`,`    downloadedImages = await fetchFilesFromPage(
      images.map(({ fileId, libraryFileId }) => ({ fileId, libraryFileId })),
      conversation.conversation_id
    );`);
  p=replace(p,"  if (!conversation || activeChatTabId === null) return;","  if (busy || !conversation) return;");
  p=replace(p,"  clearPreparedDownload();\n  exportButton.disabled = true;\n  try {","  busy = true;\n  clearPreparedDownload();\n  exportButton.disabled = true;\n  readButton.disabled = true;\n  readLinkButton.disabled = true;\n  reportButton.disabled = true;\n  try {");
  p=replace(p,"new globalThis.JSZip()","new JSZip()");
  p=replace(p,"    exportButton.disabled = false;\n  }\n}","    busy = false;\n    exportButton.disabled = false;\n    readButton.disabled = false;\n    readLinkButton.disabled = false;\n    reportButton.disabled = false;\n  }\n}");
  p=range(p,'fixedWindowButton.addEventListener("click", openWorkspace);','readLinkButton.addEventListener("click", () => {','');
  p=replace(p,'reportButton.addEventListener("click", () => {\n  const diagnostic','reportButton.addEventListener("click", () => {\n  if (busy) return;\n  const diagnostic');
  // Use the already-authorized ChatGPT origin for all relative requests.
  // Never attach bearer/account headers to external signed image URLs.
  p=replace(p,`    let downloaded = false;
    const downloadStrategies = [
      { headers: authHeaders, credentials: "include" },
      { headers: {}, credentials: "omit" }
    ];`,`    let imageURL;
    try { imageURL = new URL(downloadUrl, location.origin); } catch {}
    if (!imageURL || imageURL.protocol !== "https:") {
      results.push({ ok: false, fileId, error: "图片下载地址无效。", attempts });
      continue;
    }
    let downloaded = false;
    const downloadStrategies = imageURL.origin === location.origin
      ? [{ headers: authHeaders, credentials: "include" }, { headers: {}, credentials: "omit" }]
      : [{ headers: {}, credentials: "omit" }];`);
  p=replace(p,"const response = await fetch(downloadUrl, {","const response = await fetch(imageURL.href, {");
  p=p.replace(/\bawait fetch\(/g,"await pageFetch(");
  if(/\b(extensionAPI|activeChatTabId|workspaceMode|workspaceSourceTabId|fixedWindowButton|focusSourceButton|mainFrameResult)\b/.test(p))throw Error("Extension-only code remains");
  const lib=src["lib/conversation.js"].replace(/\bexport\s+(?=(async\s+)?function|const|let|class)/g,"");
  const metadata=`// ==UserScript==
// @name         ChatGPT Trail Exporter
// @namespace    https://github.com/Via-wan/chatgpt-trail-exporter
// @version      0.7.3
// @description  对话足迹导出：完整 JSON 分支树、Markdown + 图片、TXT、长窗口抢救。
// @author       Via-wan
// @match        https://chatgpt.com/*
// @match        https://chat.openai.com/*
// @run-at       document-end
// @inject-into  content
// @grant        none
// @noframes
// @license      MIT
// ==/UserScript==
`;
  return metadata+`
/* Built from the original exporter. JSZip 3.10.1 is bundled, with its original
 * license header; full licenses: https://github.com/Via-wan/chatgpt-trail-exporter/tree/userscripts/vendor
 * No remote dependencies or automatic network requests on page load.
 */
(() => {
  "use strict";
  if (window.top !== window.self || location.protocol !== "https:" ||
      !["chatgpt.com", "chat.openai.com"].includes(location.hostname) ||
      document.getElementById("via-wan-trail-exporter-host")) return;

  // Isolated module wrapper: do not place JSZip or exporter state on the page.
  const JSZip = (() => {
    const module = { exports: {} };
    const exports = module.exports;
    // Explicit timer fallback for isolated Safari userscript worlds.
    const setImmediate = (callback, ...args) => setTimeout(callback, 0, ...args);
    const clearImmediate = (id) => clearTimeout(id);
${src["vendor/jszip.min.js"]}
    return module.exports;
  })();

${lib}

  const pageFetch = (input, options = {}) => {
    const url = new URL(input, location.origin);
    if (url.protocol !== "https:") return Promise.reject(new Error("不安全的请求地址"));
    if (url.origin !== location.origin) {
      // External signed file URLs get no ChatGPT authorization or credentials.
      return globalThis.fetch(url.href, { ...options, credentials: "omit", headers: {}, referrerPolicy: "no-referrer" });
    }
    return globalThis.fetch(url.href, options);
  };

  const host = document.createElement("div");
  host.id = "via-wan-trail-exporter-host";
  const root = host.attachShadow({ mode: "closed" });
  const css = ${JSON.stringify(css)};
  try {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(css);
    root.adoptedStyleSheets = [sheet];
  } catch {
    const style = document.createElement("style");
    style.textContent = css;
    root.append(style);
  }
  const panel = document.createElement("section");
  panel.id = "trail-panel";
  panel.className = "trail-panel hidden";
  panel.setAttribute("aria-label", "对话足迹导出");
  // Only static, bundled markup; conversation content is rendered as text.
  const template = document.createElement("template");
  template.innerHTML = ${JSON.stringify(html)};
  panel.append(template.content.cloneNode(true));
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "trail-toggle";
  toggle.textContent = "对话导出";
  toggle.setAttribute("aria-expanded", "false");
  toggle.setAttribute("aria-controls", panel.id);
  function setPanelOpen(open) {
    panel.classList.toggle("hidden", !open);
    toggle.setAttribute("aria-expanded", String(open));
    toggle.textContent = open ? "收起导出" : "对话导出";
  }
  toggle.addEventListener("click", () => setPanelOpen(panel.classList.contains("hidden")));
  root.append(panel, toggle);
  root.querySelector("#close-button").addEventListener("click", () => {
    setPanelOpen(false);
    toggle.focus();
  });
  (document.body || document.documentElement).append(host);

${p}
})();
`;
}

const root = fileURLToPath(new URL("../", import.meta.url));
const inputs = ["popup.js", "popup.html", "popup.css", "lib/conversation.js", "vendor/jszip.min.js"];
const sources = Object.fromEntries(inputs.map(path => [path, readFileSync(resolve(root, path), "utf8")]));
const script = buildUserscript(sources);
new Function(script);
writeFileSync(resolve(root, "chatgpt-trail-exporter.user.js"), script);
