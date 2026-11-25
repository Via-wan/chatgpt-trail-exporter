import {
  analyzeConversation,
  collectCurrentPathImages,
  conversationIdFromReference,
  conversationToMarkdown,
  conversationToText,
  datedBaseFilename,
  projectIdFromReference
} from "./lib/conversation.js";

const extensionAPI = globalThis.browser ?? globalThis.chrome;

const readButton = document.querySelector("#read-button");
const fixedWindowButton = document.querySelector("#fixed-window-button");
const readLinkButton = document.querySelector("#read-link-button");
const conversationReference = document.querySelector("#conversation-reference");
const exportButton = document.querySelector("#export-button");
const jsonFormat = document.querySelector("#json-format");
const mdFormat = document.querySelector("#md-format");
const txtFormat = document.querySelector("#txt-format");
const reportButton = document.querySelector("#report-button");
const saveLink = document.querySelector("#save-link");
let preparedDownloadUrl = null;
const summary = document.querySelector("#summary");
const downloads = document.querySelector("#downloads");
const statusDot = document.querySelector("#status-dot");
const statusText = document.querySelector("#status-text");
const intro = document.querySelector("#intro");
const sourcePanel = document.querySelector("#source-panel");
const sourceTitle = document.querySelector("#source-title");
const sourceUrl = document.querySelector("#source-url");
const focusSourceButton = document.querySelector("#focus-source-button");

let conversation = null;
let report = null;
let failureReport = null;
let activeChatTabId = null;
let workspaceSourceTabId = null;
const workspaceMode = window.location.pathname.endsWith("/sidepanel.html");
const RATE_LIMIT_COOLDOWN_KEY = "trail-exporter-rate-limit-until";
const DEFAULT_RATE_LIMIT_SECONDS = 120;
const CONNECTION_RETRY_DELAYS_MS = [0, 700, 1600];

if (workspaceMode) {
  document.body.classList.add("side-panel-mode", "workspace-mode");
  fixedWindowButton.classList.add("hidden");
  readButton.disabled = true;
  readLinkButton.disabled = true;
  initializeWorkspace().catch((error) => {
    clearWorkspaceSource();
    setStatus("error", error?.message || String(error));
  });
}

function sourceTabIdFromSearch(search) {
  const raw = new URLSearchParams(search).get("sourceTabId");
  if (raw === null || !/^\d+$/.test(raw)) {
    throw new Error("缺少来源标签。请从 ChatGPT 页重新点击插件并打开独立导出页。");
  }
  const id = Number(raw);
  if (!Number.isSafeInteger(id)) throw new Error("来源标签 ID 无效。");
  return id;
}

function mainFrameResult(injection) {
  const frame = injection?.find((item) => item.frameId === 0) ?? injection?.[0];
  if (frame?.error) throw new Error(frame.error.message || String(frame.error));
  if (!frame || frame.result == null) {
    throw new Error("Safari 未返回页面读取结果。请确认已允许扩展访问此 ChatGPT 网站，然后重试。");
  }
  return frame.result;
}

function setStatus(kind, text) {
  statusDot.className = `status-dot ${kind}`;
  statusText.textContent = text;
}

function wait(milliseconds) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

function looksLikePageConnectionFailure(result, thrownError = null) {
  if (thrownError) {
    return /failed to fetch|load failed|networkerror|cannot access|receiving end|frame|context invalidated/i.test(
      thrownError?.message || String(thrownError)
    );
  }
  const attempts = result?.attempts ?? [];
  return (
    !result?.ok &&
    attempts.length > 0 &&
    attempts.every(
      (attempt) =>
        attempt.status == null &&
        /failed to fetch|load failed|networkerror/i.test(attempt.error || "")
    )
  );
}

async function executeConversationReadWithRetry(tabId, args) {
  let lastResult = null;
  let lastError = null;

  for (let index = 0; index < CONNECTION_RETRY_DELAYS_MS.length; index += 1) {
    const delay = CONNECTION_RETRY_DELAYS_MS[index];
    if (delay) {
      setStatus(
        "loading",
        `页面连接尚未就绪，正在自动重连（${index + 1}/${CONNECTION_RETRY_DELAYS_MS.length}）…`
      );
      await wait(delay);
    }

    try {
      const injection = await extensionAPI.scripting.executeScript({
        target: { tabId },
        world: "MAIN",
        func: fetchConversationFromPage,
        args
      });
      lastResult = mainFrameResult(injection);
      lastError = null;
      if (!looksLikePageConnectionFailure(lastResult)) {
        return lastResult;
      }
    } catch (error) {
      lastError = error;
      if (!looksLikePageConnectionFailure(null, error)) {
        throw error;
      }
    }
  }

  if (lastResult) {
    return {
      ...lastResult,
      error: "页面连接尚未就绪，请点击“读取”重新连接。",
      pageConnectionFailure: true
    };
  }
  throw new Error(
    lastError?.message || "页面连接尚未就绪，请点击“读取”重新连接。"
  );
}

function cooldownRemainingSeconds() {
  const retryAt = Number(localStorage.getItem(RATE_LIMIT_COOLDOWN_KEY));
  if (!Number.isFinite(retryAt)) return 0;
  const remaining = Math.ceil((retryAt - Date.now()) / 1000);
  if (remaining <= 0) {
    localStorage.removeItem(RATE_LIMIT_COOLDOWN_KEY);
    return 0;
  }
  return remaining;
}

function cooldownLabel(seconds) {
  if (seconds < 60) return `${seconds} 秒`;
  return `${Math.ceil(seconds / 60)} 分钟`;
}

function assertChatGPTPage(urlString) {
  const url = new URL(urlString);
  if (url.protocol !== "https:" || !["chatgpt.com", "chat.openai.com"].includes(url.hostname)) {
    throw new Error("请先在当前标签打开任意 ChatGPT 页面。");
  }
}

function showSourceTab(tab) {
  sourcePanel.classList.remove("hidden");
  sourceTitle.textContent = tab?.title || "未命名 ChatGPT 标签";
  sourceUrl.textContent = tab?.url || "";
  focusSourceButton.disabled = !Number.isInteger(tab?.id);
}

function showMissingSource() {
  sourcePanel.classList.remove("hidden");
  sourceTitle.textContent = "此标签已不可用";
  sourceUrl.textContent = "请在目标 ChatGPT 标签重新打开独立导出页";
  focusSourceButton.disabled = true;
}

function clearWorkspaceSource() {
  workspaceSourceTabId = null;
  readButton.disabled = true;
  readLinkButton.disabled = true;
  showMissingSource();
}

async function currentBrowserTab() {
  const [tab] = await extensionAPI.tabs.query({
    active: true,
    currentWindow: true
  });
  if (!Number.isInteger(tab?.id) || !tab.url) {
    throw new Error("无法识别当前标签页。请先允许扩展访问 ChatGPT 网站。");
  }
  return tab;
}

async function initializeWorkspace() {
  const sourceId = sourceTabIdFromSearch(window.location.search);
  const tab = await extensionAPI.tabs.get(sourceId);
  if (!tab?.url) throw new Error("无法访问来源标签。请先在 ChatGPT 网页选择始终允许此网站。");
  assertChatGPTPage(tab.url);
  workspaceSourceTabId = sourceId;
  showSourceTab(tab);
  setStatus("idle", "独立导出页已绑定来源标签，可保持打开并切换标签。");
  readButton.disabled = false;
  readLinkButton.disabled = false;
}

async function getSourceChatTab() {
  if (workspaceMode) {
    if (workspaceSourceTabId === null) {
      throw new Error("来源标签不可用，请从 ChatGPT 页面重新打开导出页。");
    }
    try {
      const tab = await extensionAPI.tabs.get(workspaceSourceTabId);
      if (Number.isInteger(tab?.id) && tab.url) {
        assertChatGPTPage(tab.url);
        showSourceTab(tab);
        return tab;
      }
    } catch {
      // Report a missing or no longer authorized source below.
    }
    clearWorkspaceSource();
    throw new Error("来源标签已关闭、离开 ChatGPT 或未授予网站权限，请重新打开独立导出页。");
  }
  return currentBrowserTab();
}

async function openWorkspace() {
  fixedWindowButton.disabled = true;
  try {
    const tab = await currentBrowserTab();
    assertChatGPTPage(tab.url);
    const url = extensionAPI.runtime.getURL("sidepanel.html") +
      "?sourceTabId=" + encodeURIComponent(String(tab.id));
    await extensionAPI.tabs.create({ url, active: true });
    // Safari automatically dismisses the toolbar popup when changing tabs.
  } catch (error) {
    setStatus("error", error?.message || String(error));
    fixedWindowButton.disabled = false;
  }
}

async function focusSourceTab() {
  if (workspaceSourceTabId === null) return;
  try {
    const tab = await extensionAPI.tabs.update(workspaceSourceTabId, { active: true });
    if (tab?.windowId !== undefined) {
      await extensionAPI.windows.update(tab.windowId, { focused: true });
    }
  } catch {
    clearWorkspaceSource();
    setStatus("error", "来源标签已经关闭，请重新打开独立导出页。");
  }
}

async function fetchConversationFromPage(
  conversationId,
  hintedProjectId = null,
  preferScopedDiscovery = false
) {
  if (location.protocol !== "https:" || !["chatgpt.com", "chat.openai.com"].includes(location.hostname)) {
    return { ok: false, error: "来源页面已离开 ChatGPT。", attempts: [] };
  }
  const attempts = [];
  let accessToken = null;
  let accountId = null;
  let rateLimit = null;

  function retryAfterSeconds(response) {
    const value = response?.headers?.get?.("Retry-After");
    if (!value) return 120;
    const seconds = Number(value);
    if (Number.isFinite(seconds) && seconds > 0) {
      return Math.ceil(seconds);
    }
    const retryAt = Date.parse(value);
    if (Number.isFinite(retryAt)) {
      return Math.max(1, Math.ceil((retryAt - Date.now()) / 1000));
    }
    return 120;
  }

  function captureRateLimit(response) {
    if (response?.status !== 429) return;
    const seconds = retryAfterSeconds(response);
    rateLimit = {
      retry_after_seconds: seconds,
      retry_at: new Date(Date.now() + seconds * 1000).toISOString()
    };
  }

  try {
    const sessionResponse = await fetch("/api/auth/session", {
      credentials: "include",
      cache: "no-store"
    });
    attempts.push({
      url: "/api/auth/session",
      status: sessionResponse.status
    });
    if (sessionResponse.ok) {
      const session = await sessionResponse.json();
      accessToken = session?.accessToken ?? null;
      accountId =
        session?.account?.id ??
        session?.user?.account_id ??
        session?.user?.accountId ??
        null;
    }
  } catch (error) {
    attempts.push({
      url: "/api/auth/session",
      status: null,
      error: String(error)
    });
  }

  const baseHeaders = {
    Accept: "application/json"
  };
  if (accessToken) {
    baseHeaders.Authorization = `Bearer ${accessToken}`;
  }
  if (accountId) {
    baseHeaders["ChatGPT-Account-Id"] = accountId;
  }

  const fullEndpoint =
    `/backend-api/conversation/${encodeURIComponent(conversationId)}`;

  async function requestFullConversation(
    requestHeaders,
    strategy,
    projectId = null
  ) {
    const startedAt = performance.now();
    try {
      const response = await fetch(fullEndpoint, {
        method: "GET",
        credentials: "include",
        cache: "no-store",
        headers: requestHeaders
      });
      const attempt = {
        strategy,
        url: fullEndpoint,
        status: response.status,
        duration_ms: Math.round(performance.now() - startedAt),
        account_header: Boolean(accountId),
        project_id: projectId
      };
      if (!response.ok) {
        const errorText = (await response.text()).slice(0, 500);
        attempt.error = errorText || null;
        attempts.push(attempt);
        captureRateLimit(response);
        return null;
      }

      attempts.push(attempt);
      const text = await response.text();
      JSON.parse(text);
      return text;
    } catch (error) {
      attempts.push({
        strategy,
        url: fullEndpoint,
        status: null,
        duration_ms: Math.round(performance.now() - startedAt),
        account_header: Boolean(accountId),
        project_id: projectId,
        error: String(error)
      });
      return null;
    }
  }

  const encodedId = encodeURIComponent(conversationId);
  let conversationHeaders = { ...baseHeaders };
  let projectId =
    typeof hintedProjectId === "string" &&
    hintedProjectId.startsWith("g-p-")
      ? hintedProjectId
      : null;
  let projectOwnerId = null;
  let projectScopedFullAttempted = false;
  let baseFullAttempted = false;
  const pageSizes = [4, 1];
  const pages = [];
  let metadata = null;
  let pageSize = null;
  let anchorMessageId = null;
  let anchorIsCurrentNode = false;
  let recoveryStrategy = "paginated_first_page";
  let cursor = null;
  let pageCount = 0;
  let paginationComplete = false;
  const seenCursors = new Set();
  const messageAnchors = [];
  const seenAnchorIds = new Set();
  let historyItem = null;
  let searchItem = null;

  function failureResult(
    error = "ChatGPT 没有返回可用的对话 JSON。"
  ) {
    return {
      ok: false,
      attempts,
      rateLimited: Boolean(rateLimit),
      rateLimit,
      diagnostics: {
        history_item_found: Boolean(historyItem),
        history_title: historyItem?.title ?? null,
        message_anchors: messageAnchors,
        account_header: Boolean(accountId),
        project_id: projectId,
        project_owner_id: projectOwnerId,
        attempted_project_scoped_retry: attempts.some(
          (attempt) =>
            attempt.strategy === "full_project_scoped" ||
            attempt.strategy === "full_project_hint"
        ),
        strategies: [...new Set(
          attempts.map((attempt) => attempt.strategy).filter(Boolean)
        )]
      },
      error
    };
  }

  if (projectId) {
    conversationHeaders["chatgpt-project-id"] = projectId;
    projectScopedFullAttempted = true;
    const hintedScopedFullText = await requestFullConversation(
      conversationHeaders,
      "full_project_hint",
      projectId
    );
    if (hintedScopedFullText) {
      return {
        ok: true,
        jsonText: hintedScopedFullText,
        attempts,
        mode: "full_project_hint"
      };
    }
    if (rateLimit) {
      return failureResult("ChatGPT 正在限制读取频率。");
    }
  } else if (!preferScopedDiscovery) {
    baseFullAttempted = true;
    const initialFullText = await requestFullConversation(
      baseHeaders,
      "full_base"
    );
    if (initialFullText) {
      return {
        ok: true,
        jsonText: initialFullText,
        attempts,
        mode: "full"
      };
    }
    if (rateLimit) {
      return failureResult("ChatGPT 正在限制读取频率。");
    }
  }

  async function requestPage(endpoint, strategy, details = {}) {
    const startedAt = performance.now();
    try {
      const response = await fetch(endpoint, {
        method: "GET",
        credentials: "include",
        cache: "no-store",
        headers: conversationHeaders
      });
      if (!response.ok) {
        const errorText = (await response.text()).slice(0, 500);
        attempts.push({
          strategy,
          url: endpoint,
          status: response.status,
          duration_ms: Math.round(performance.now() - startedAt),
          account_header: Boolean(accountId),
          project_id: projectId,
          ...details,
          error: errorText || null
        });
        captureRateLimit(response);
        return null;
      }

      const payload = await response.json();
      attempts.push({
        strategy,
        url: endpoint,
        status: response.status,
        duration_ms: Math.round(performance.now() - startedAt),
        account_header: Boolean(accountId),
        project_id: projectId,
        message_count: Array.isArray(payload?.messages)
          ? payload.messages.length
          : null,
        ...details
      });
      if (!Array.isArray(payload?.messages)) {
        attempts.at(-1).error = "响应中缺少 messages。";
        return null;
      }
      return payload;
    } catch (error) {
      attempts.push({
        strategy,
        url: endpoint,
        status: null,
        duration_ms: Math.round(performance.now() - startedAt),
        account_header: Boolean(accountId),
        project_id: projectId,
        ...details,
        error: String(error)
      });
      return null;
    }
  }

  async function requestMetadata(endpoint, strategy) {
    const startedAt = performance.now();
    try {
      const response = await fetch(endpoint, {
        method: "GET",
        credentials: "include",
        cache: "no-store",
        headers: baseHeaders
      });
      if (!response.ok) {
        const errorText = (await response.text()).slice(0, 500);
        attempts.push({
          strategy,
          url: endpoint,
          status: response.status,
          duration_ms: Math.round(performance.now() - startedAt),
          account_header: Boolean(accountId),
          error: errorText || null
        });
        captureRateLimit(response);
        return null;
      }
      const payload = await response.json();
      attempts.push({
        strategy,
        url: endpoint,
        status: response.status,
        duration_ms: Math.round(performance.now() - startedAt),
        account_header: Boolean(accountId),
        item_count: Array.isArray(payload?.items) ? payload.items.length : null
      });
      return payload;
    } catch (error) {
      attempts.push({
        strategy,
        url: endpoint,
        status: null,
        duration_ms: Math.round(performance.now() - startedAt),
        account_header: Boolean(accountId),
        error: String(error)
      });
      return null;
    }
  }

  function addAnchor(id, isCurrentNode, source) {
    if (typeof id !== "string" || !id || seenAnchorIds.has(id)) {
      return;
    }
    seenAnchorIds.add(id);
    messageAnchors.push({ id, isCurrentNode, source });
  }

  for (const archived of [false, true]) {
    const maxPages = archived ? 3 : 10;
    for (let page = 0; page < maxPages; page += 1) {
      const offset = page * 28;
      const historyEndpoint =
        `/backend-api/conversations?offset=${offset}&limit=28&order=updated` +
        `&is_archived=${archived}`;
      const history = await requestMetadata(
        historyEndpoint,
        archived ? "history_archived" : "history_active"
      );
      if (rateLimit) {
        return failureResult("ChatGPT 正在限制读取频率。");
      }
      const items = history?.items ?? [];
      historyItem = items.find(
        (item) =>
          item?.id === conversationId ||
          item?.conversation_id === conversationId
      );
      if (historyItem || items.length < 28) {
        break;
      }
    }
    if (historyItem) {
      break;
    }
  }

  if (historyItem) {
    addAnchor(
      historyItem.current_node_id ?? historyItem.current_node,
      true,
      "history_current_node"
    );
    addAnchor(
      historyItem.last_message_id ?? historyItem.latest_message_id,
      true,
      "history_last_message"
    );
    addAnchor(historyItem.message_id, false, "history_message");

    const searchQuery = String(historyItem.title ?? "").trim();
    if (searchQuery) {
      const searchEndpoint =
        `/backend-api/conversations/search?query=` +
        `${encodeURIComponent(searchQuery)}`;
      const search = await requestMetadata(
        searchEndpoint,
        "conversation_search"
      );
      if (rateLimit) {
        return failureResult("ChatGPT 正在限制读取频率。");
      }
      searchItem = (search?.items ?? []).find(
        (item) => item?.conversation_id === conversationId
      );
      if (searchItem) {
        addAnchor(
          searchItem.current_node_id,
          true,
          "search_current_node"
        );
        addAnchor(
          searchItem.payload?.message_id,
          false,
          "search_match"
        );
      }
    }
  }

  function firstProjectId(...items) {
    for (const item of items) {
      const candidates = [
        item?.gizmo_id,
        item?.gizmo?.id,
        item?.project_id,
        item?.project?.id,
        item?.conversation_template_id,
        item?.payload?.gizmo_id,
        item?.payload?.gizmo?.id,
        item?.payload?.project_id,
        item?.payload?.project?.id
      ];
      const candidate = candidates.find(
        (value) => typeof value === "string" && value.startsWith("g-p-")
      );
      if (candidate) return candidate;
    }
    return null;
  }

  function firstProjectOwnerId(...items) {
    for (const item of items) {
      const candidates = [
        item?.shared_project_conversation_owner?.id,
        item?.sharedProjectConversationOwner?.id,
        item?.conversation_owner_id,
        item?.owner_user_id,
        item?.payload?.conversation_owner_id,
        item?.payload?.owner_user_id
      ];
      const candidate = candidates.find(
        (value) => typeof value === "string" && value
      );
      if (candidate) return candidate;
    }
    return null;
  }

  projectId = projectId ?? firstProjectId(historyItem, searchItem);
  projectOwnerId = firstProjectOwnerId(historyItem, searchItem);
  if (projectId) {
    conversationHeaders = {
      ...baseHeaders,
      "chatgpt-project-id": projectId
    };
    if (projectOwnerId) {
      conversationHeaders["chatgpt-conv-owner-id"] = projectOwnerId;
    }

    if (!projectScopedFullAttempted) {
      projectScopedFullAttempted = true;
      const scopedFullText = await requestFullConversation(
        conversationHeaders,
        "full_project_scoped",
        projectId
      );
      if (scopedFullText) {
        return {
          ok: true,
          jsonText: scopedFullText,
          attempts,
          mode: "full_project_scoped"
        };
      }
      if (rateLimit) {
        return failureResult("ChatGPT 正在限制读取频率。");
      }
    }
  }

  if (!projectId && !baseFullAttempted) {
    baseFullAttempted = true;
    const discoveredBaseFullText = await requestFullConversation(
      baseHeaders,
      "full_after_discovery"
    );
    if (discoveredBaseFullText) {
      return {
        ok: true,
        jsonText: discoveredBaseFullText,
        attempts,
        mode: "full_after_discovery"
      };
    }
    if (rateLimit) {
      return failureResult("ChatGPT 正在限制读取频率。");
    }
  }

  const firstPageTargets = [
    ...messageAnchors,
    { id: null, isCurrentNode: true, source: "default_current_node" }
  ];

  for (const target of firstPageTargets) {
    for (const candidateSize of pageSizes) {
      const query = new URLSearchParams({
        num_turns: String(candidateSize)
      });
      if (target.id) {
        query.set("include_message_id", target.id);
      }
      const endpoint =
        `/backend-api/conversations/${encodedId}?${query.toString()}`;
      const payload = await requestPage(endpoint, "paginated_entry", {
        anchor_source: target.source,
        anchor_message_id: target.id,
        num_turns: candidateSize
      });
      if (rateLimit) {
        return failureResult("ChatGPT 正在限制读取频率。");
      }
      if (!payload) {
        continue;
      }

      metadata = payload;
      pageSize = candidateSize;
      anchorMessageId = target.id;
      anchorIsCurrentNode = target.isCurrentNode;
      pages.unshift(payload.messages);
      pageCount = 1;
      const pageInfo = payload.page_info ?? {};
      cursor = pageInfo.start_cursor ?? null;
      paginationComplete = !pageInfo.has_previous_page;
      break;
    }
    if (metadata) {
      break;
    }
  }

  while (
    metadata &&
    !paginationComplete &&
    cursor &&
    !seenCursors.has(cursor) &&
    pageCount < 1000
  ) {
    seenCursors.add(cursor);
    let payload = null;
    const retrySizes = [...new Set([pageSize, 4, 1])];
    for (const candidateSize of retrySizes) {
      const endpoint =
        `/backend-api/conversations/${encodedId}/messages` +
        `?before=${encodeURIComponent(cursor)}&num_turns=${candidateSize}`;
      payload = await requestPage(endpoint, "cursor_page", {
        cursor,
        num_turns: candidateSize,
        page_number: pageCount + 1
      });
      if (rateLimit) {
        return failureResult("ChatGPT 正在限制读取频率。");
      }
      if (payload) {
        pageSize = candidateSize;
        break;
      }
    }
    if (!payload) {
      break;
    }

    pages.unshift(payload.messages);
    pageCount += 1;
    const pageInfo = payload.page_info ?? {};
    const nextCursor = pageInfo.start_cursor ?? null;
    paginationComplete = !pageInfo.has_previous_page;
    cursor = nextCursor;
  }

  let rescuedMessages = [];
  if (metadata && pages.length > 0) {
    const seenMessageIds = new Set();
    for (const page of pages) {
      for (const message of page) {
        if (!message?.id || seenMessageIds.has(message.id)) {
          continue;
        }
        seenMessageIds.add(message.id);
        rescuedMessages.push(message);
      }
    }
    if (rescuedMessages.length === 0) {
      metadata = null;
    }
  }

  if (metadata && pages.length > 0) {
    const messages = rescuedMessages;
    const rootId = `paginated-root:${conversationId}`;
    const mapping = {
      [rootId]: {
        id: rootId,
        message: null,
        parent: null,
        children: messages[0]?.id ? [messages[0].id] : []
      }
    };
    messages.forEach((message, index) => {
      mapping[message.id] = {
        id: message.id,
        message,
        parent: index === 0 ? rootId : messages[index - 1].id,
        children:
          index + 1 < messages.length ? [messages[index + 1].id] : []
      };
    });

    const {
      messages: ignoredMessages,
      page_info: ignoredPageInfo,
      mapping: ignoredMapping,
      current_node: ignoredCurrentNode,
      ...conversationMetadata
    } = metadata;
    const currentPathComplete =
      paginationComplete && (!anchorMessageId || anchorIsCurrentNode);
    const reconstructed = {
      ...conversationMetadata,
      conversation_id:
        conversationMetadata.conversation_id ??
        conversationMetadata.id ??
        conversationId,
      mapping,
      current_node: messages.at(-1)?.id ?? rootId,
      trail_exporter: {
        source: "paginated_rescue",
        branch_tree_complete: false,
        current_path_complete: currentPathComplete,
        anchor_message_id: anchorMessageId,
        anchor_is_current_node: anchorIsCurrentNode,
        recovery_strategy: recoveryStrategy,
        request_scope: {
          account_header: Boolean(accountId),
          project_id: projectId,
          project_owner_id: projectOwnerId
        },
        cursor_message_included: true,
        page_count: pages.length,
        message_count: messages.length,
        note: currentPathComplete
          ? "完整对话树接口失败；此文件由 ChatGPT 分页接口重建，仅保证当前路径，不包含未返回的隐藏分支。"
          : "完整对话树或后续分页读取有失败；此文件只包含成功返回的路径片段。"
      }
    };
    return {
      ok: true,
      jsonText: JSON.stringify(reconstructed),
      attempts,
      mode: "paginated_rescue"
    };
  }

  return failureResult();
}

async function fetchFilesFromPage(fileRequests, conversationId) {
  if (location.protocol !== "https:" || !["chatgpt.com", "chat.openai.com"].includes(location.hostname)) {
    return fileRequests.map(({ fileId }) => ({
      fileId, ok: false, error: "来源页面已离开 ChatGPT。", attempts: []
    }));
  }
  const results = [];
  let accessToken = null;
  let accountId = null;

  try {
    const sessionResponse = await fetch("/api/auth/session", {
      credentials: "include",
      cache: "no-store"
    });
    if (sessionResponse.ok) {
      const session = await sessionResponse.json();
      accessToken = session?.accessToken ?? null;
      accountId =
        session?.account?.id ??
        session?.user?.account_id ??
        session?.user?.accountId ??
        null;
    }
  } catch {
    // Individual file requests below will return a useful error.
  }

  const authHeaders = {
    Accept: "application/json"
  };
  if (accessToken) {
    authHeaders.Authorization = `Bearer ${accessToken}`;
    authHeaders["X-OpenAI-Attach-Auth"] = "true";
  }
  if (accountId) {
    authHeaders["ChatGPT-Account-Id"] = accountId;
  }

  async function responseToBase64(response) {
    const buffer = await response.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    const chunkSize = 0x8000;
    let binary = "";
    for (let index = 0; index < bytes.length; index += chunkSize) {
      binary += String.fromCharCode(
        ...bytes.subarray(index, index + chunkSize)
      );
    }
    return {
      base64: btoa(binary),
      sizeBytes: bytes.length,
      mimeType:
        response.headers.get("content-type")?.split(";")[0] ||
        "application/octet-stream"
    };
  }

  for (const request of fileRequests) {
    const fileId = request.fileId;
    const attempts = [];
    const encodedConversationId = encodeURIComponent(conversationId);
    let downloadUrl = null;
    let directPayload = null;
    let resolvedSource = null;

    async function resolveFile(candidateFileId, source) {
      const encodedFileId = encodeURIComponent(candidateFileId);
      const metadataEndpoints = [
        `/backend-api/files/download/${encodedFileId}?check_context_scopes_for_conversation_id=${encodedConversationId}&inline=true&download_intent=false`,
        `/backend-api/files/download/${encodedFileId}?conversation_id=${encodedConversationId}&inline=true&download_intent=false`,
        `/backend-api/files/download/${encodedFileId}`,
        `/backend-api/files/${encodedFileId}/download`
      ];

      for (const endpoint of metadataEndpoints) {
        try {
          const response = await fetch(endpoint, {
            credentials: "include",
            cache: "no-store",
            headers: authHeaders
          });
          const attempt = {
            stage: "resolve",
            source,
            endpoint,
            status: response.status
          };
          if (!response.ok) {
            try {
              const detail = (await response.text()).slice(0, 500);
              if (detail) attempt.detail = detail;
            } catch {
              // Status and endpoint are enough if the body cannot be read.
            }
            attempts.push(attempt);
            continue;
          }
          attempts.push(attempt);

          const contentType = response.headers.get("content-type") || "";
          if (contentType.includes("application/json")) {
            const payload = await response.json();
            downloadUrl =
              payload?.download_url ??
              payload?.url ??
              payload?.file?.download_url ??
              null;
          } else {
            directPayload = await responseToBase64(response);
          }
          if (downloadUrl || directPayload) {
            resolvedSource = source;
            return true;
          }
        } catch (error) {
          attempts.push({
            stage: "resolve",
            source,
            endpoint,
            status: null,
            error: String(error)
          });
        }
      }
      return false;
    }

    await resolveFile(fileId, "conversation_file");

    if (!downloadUrl && !directPayload && request.libraryFileId) {
      const versionsEndpoint =
        `/backend-api/files/library/files/${encodeURIComponent(request.libraryFileId)}/versions?limit=100`;
      try {
        const response = await fetch(versionsEndpoint, {
          credentials: "include",
          cache: "no-store",
          headers: authHeaders
        });
        const attempt = {
          stage: "library_versions",
          endpoint: versionsEndpoint,
          status: response.status
        };
        if (response.ok) {
          const payload = await response.json();
          const versions = Array.isArray(payload?.items) ? payload.items : [];
          const currentVersion =
            versions.find((item) => item?.is_current === true) ??
            versions
              .filter((item) => typeof item?.version_number === "number")
              .sort((a, b) => b.version_number - a.version_number)[0] ??
            null;
          attempt.currentFileId = currentVersion?.file_id ?? null;
          attempts.push(attempt);
          if (currentVersion?.file_id) {
            await resolveFile(currentVersion.file_id, "library_current_version");
          }
        } else {
          try {
            const detail = (await response.text()).slice(0, 500);
            if (detail) attempt.detail = detail;
          } catch {
            // Keep the status even if the response body is unavailable.
          }
          attempts.push(attempt);
        }
      } catch (error) {
        attempts.push({
          stage: "library_versions",
          endpoint: versionsEndpoint,
          status: null,
          error: String(error)
        });
      }
    }

    if (!downloadUrl && !directPayload && request.libraryFileId) {
      const thumbnailEndpoint =
        `/backend-api/files/library/files/${encodeURIComponent(request.libraryFileId)}/thumbnail`;
      try {
        const response = await fetch(thumbnailEndpoint, {
          credentials: "include",
          cache: "no-store",
          headers: authHeaders
        });
        const attempt = {
          stage: "library_thumbnail",
          endpoint: thumbnailEndpoint,
          status: response.status
        };
        if (response.ok) {
          const payload = await response.json();
          downloadUrl =
            payload?.thumbnail_url ??
            payload?.download_url ??
            payload?.url ??
            null;
          attempt.hasUrl = Boolean(downloadUrl);
          attempts.push(attempt);
          if (downloadUrl) resolvedSource = "library_thumbnail";
        } else {
          try {
            const detail = (await response.text()).slice(0, 500);
            if (detail) attempt.detail = detail;
          } catch {
            // Keep the status even if the response body is unavailable.
          }
          attempts.push(attempt);
        }
      } catch (error) {
        attempts.push({
          stage: "library_thumbnail",
          endpoint: thumbnailEndpoint,
          status: null,
          error: String(error)
        });
      }
    }

    if (directPayload) {
      results.push({
        ok: true,
        fileId,
        source: resolvedSource,
        isPreview: resolvedSource === "library_thumbnail",
        ...directPayload,
        attempts
      });
      continue;
    }

    if (!downloadUrl) {
      results.push({
        ok: false,
        fileId,
        error: "没有取得图片下载地址。",
        attempts
      });
      continue;
    }

    let downloaded = false;
    const downloadStrategies = [
      { headers: authHeaders, credentials: "include" },
      { headers: {}, credentials: "omit" }
    ];
    for (const strategy of downloadStrategies) {
      try {
        const response = await fetch(downloadUrl, {
          cache: "no-store",
          headers: strategy.headers,
          credentials: strategy.credentials
        });
        attempts.push({
          stage: "download",
          status: response.status,
          authenticated: Boolean(strategy.headers.Authorization)
        });
        if (!response.ok) {
          continue;
        }
        const payload = await responseToBase64(response);
        results.push({
          ok: true,
          fileId,
          source: resolvedSource,
          isPreview: resolvedSource === "library_thumbnail",
          ...payload,
          attempts
        });
        downloaded = true;
        break;
      } catch (error) {
        attempts.push({
          stage: "download",
          status: null,
          authenticated: Boolean(strategy.headers.Authorization),
          error: String(error)
        });
      }
    }

    if (!downloaded) {
      results.push({
        ok: false,
        fileId,
        error: "图片内容下载失败。",
        attempts
      });
    }
  }

  return results;
}

async function readConversation(reference = null) {
  const cooldownSeconds = cooldownRemainingSeconds();
  if (cooldownSeconds > 0) {
    setStatus(
      "error",
      `ChatGPT 仍在限流，请约 ${cooldownLabel(cooldownSeconds)}后再试；插件不会继续追加请求。`
    );
    return;
  }

  clearPreparedDownload();
  readButton.disabled = true;
  readLinkButton.disabled = true;
  fixedWindowButton.disabled = true;
  conversationReference.disabled = true;
  summary.classList.add("hidden");
  downloads.classList.add("hidden");
  conversation = null;
  report = null;
  failureReport = null;
  activeChatTabId = null;
  downloads.classList.remove("failure-mode");
  document.querySelector(".format-picker").classList.remove("hidden");
  exportButton.classList.remove("hidden");
  reportButton.textContent = "诊断报告";
  setStatus(
    "loading",
    workspaceMode
      ? "正在读取完整对话树；可以切换到其他窗口。"
      : "正在读取完整对话树，请保持弹窗开启…"
  );

  try {
    const tab = await getSourceChatTab();
    assertChatGPTPage(tab.url);
    const conversationReferenceValue = reference ?? tab.url;
    const conversationId = conversationIdFromReference(
      conversationReferenceValue
    );
    const hintedProjectId = projectIdFromReference(
      conversationReferenceValue
    );
    activeChatTabId = tab.id;
    const result = await executeConversationReadWithRetry(tab.id, [
      conversationId,
      hintedProjectId,
      Boolean(reference)
    ]);

    if (!result?.ok) {
      if (result?.rateLimited) {
        const retrySeconds = Math.max(
          1,
          Number(result?.rateLimit?.retry_after_seconds) ||
            DEFAULT_RATE_LIMIT_SECONDS
        );
        localStorage.setItem(
          RATE_LIMIT_COOLDOWN_KEY,
          String(Date.now() + retrySeconds * 1000)
        );
      }
      const statusCounts = new Map();
      for (const item of result?.attempts ?? []) {
        const status = String(item.status ?? "网络错误");
        statusCounts.set(status, (statusCounts.get(status) ?? 0) + 1);
      }
      const statuses = [...statusCounts.entries()]
        .map(([status, count]) => (count > 1 ? `${status}×${count}` : status))
        .join(" / ");
      const serverDetail = [...(result?.attempts ?? [])]
        .reverse()
        .find((item) => item.error)?.error;
      const diagnostics = result?.diagnostics;
      const anchorDetail = diagnostics
        ? ` 定位：历史${diagnostics.history_item_found ? "成功" : "失败"}，消息锚点 ${diagnostics.message_anchors?.length ?? 0} 个；` +
          `账号头${diagnostics.account_header ? "已带" : "缺失"}，` +
          `项目${diagnostics.project_id ? "已识别并重试" : "未识别"}。`
        : "";
      failureReport = {
        generated_at: new Date().toISOString(),
        conversation_id: conversationId,
        error: result?.error ?? "读取失败",
        rate_limit: result?.rateLimit ?? null,
        diagnostics: result?.diagnostics ?? null,
        attempts: result?.attempts ?? []
      };
      downloads.classList.add("failure-mode");
      downloads.classList.remove("hidden");
      document.querySelector(".format-picker").classList.add("hidden");
      exportButton.classList.add("hidden");
      reportButton.textContent = "下载失败诊断";
      if (result?.rateLimited) {
        const retrySeconds =
          Number(result?.rateLimit?.retry_after_seconds) ||
          DEFAULT_RATE_LIMIT_SECONDS;
        throw new Error(
          `ChatGPT 正在限流，请约 ${cooldownLabel(retrySeconds)}后再试；插件已在第一次 429 后停止，没有继续追加请求。`
        );
      }
      throw new Error(
        `${result?.error ?? "读取失败"}${statuses ? `（状态：${statuses}）` : ""}` +
        anchorDetail +
        `${serverDetail ? ` 服务器信息：${serverDetail.slice(0, 240)}` : ""}`
      );
    }

    conversation = JSON.parse(result.jsonText);
    report = analyzeConversation(conversation);
    renderSummary(report);
    setStatus(
      report.integrity.ok ? "ok" : "error",
      report.integrity.ok
        ? !report.branchTreeComplete
          ? report.currentPathComplete
            ? `分页抢救成功：恢复 ${report.messageNodeCount.toLocaleString()} 条当前路径消息；隐藏分支未包含。`
            : `分页只救回 ${report.messageNodeCount.toLocaleString()} 条路径片段；更早消息仍读取失败。`
          : reference
          ? "抢救读取成功，目标窗口无需渲染。"
          : "读取成功，分支树引用完整。"
        : `读取成功，但发现 ${report.integrity.structuralErrorCount} 个结构问题。`
    );
  } catch (error) {
    setStatus("error", error?.message || String(error));
  } finally {
    const sourceMissing = workspaceMode && workspaceSourceTabId === null;
    readButton.disabled = sourceMissing;
    readLinkButton.disabled = sourceMissing;
    fixedWindowButton.disabled = false;
    conversationReference.disabled = false;
  }
}

function renderSummary(data) {
  document.querySelector("#conversation-title").textContent = data.title;
  document.querySelector("#node-count").textContent =
    data.nodeCount.toLocaleString();
  document.querySelector("#path-count").textContent =
    data.currentPathNodeCount.toLocaleString();
  document.querySelector("#branch-count").textContent =
    data.branchPointCount.toLocaleString();
  document.querySelector("#tree-health").textContent =
    data.branchTreeComplete === false
      ? data.currentPathComplete
        ? "当前路径"
        : "路径片段"
      : data.integrity.ok
        ? "完整"
        : "异常";
  summary.classList.remove("hidden");
  downloads.classList.remove("hidden");
}

function downloadText(text, filename, mimeType) {
  const blob = new Blob([text], { type: `${mimeType};charset=utf-8` });
  downloadBlob(blob, filename);
}

function clearPreparedDownload() {
  if (preparedDownloadUrl !== null) URL.revokeObjectURL(preparedDownloadUrl);
  preparedDownloadUrl = null;
  saveLink.classList.add("hidden");
  saveLink.removeAttribute("href");
  saveLink.removeAttribute("download");
}

function downloadBlob(blob, filename) {
  // Safari may block a scripted download after an asynchronous ZIP operation.
  // Present a real, user-clicked download link instead, and keep the Blob alive
  // until another export is prepared or this extension page is closed.
  clearPreparedDownload();
  preparedDownloadUrl = URL.createObjectURL(blob);
  saveLink.href = preparedDownloadUrl;
  saveLink.download = filename;
  saveLink.textContent = "点击保存：" + filename;
  saveLink.classList.remove("hidden");
}

function baseFilename() {
  return datedBaseFilename(conversation);
}

async function addMarkdownContents(zipRoot, base) {
  const images = collectCurrentPathImages(conversation);
  const imagePaths = Object.fromEntries(
    images.map((image) => [image.fileId, image.relativePath])
  );
  setStatus(
    "loading",
    images.length
      ? `正在下载 ${images.length} 张图片并打包…`
      : "当前路径没有图片，正在生成 Markdown…"
  );

  let downloadedImages = [];
  if (images.length) {
    const injection = await extensionAPI.scripting.executeScript({
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
    downloadedImages = mainFrameResult(injection);
    if (!Array.isArray(downloadedImages)) throw new Error("Safari 返回的图片读取结果无效。");
  }

  const resultById = new Map(
    downloadedImages.map((result) => [result.fileId, result])
  );
  const failures = [];
  const previewFallbacks = [];
  const extensionByMime = {
    "image/avif": "avif",
    "image/gif": "gif",
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/svg+xml": "svg",
    "image/webp": "webp"
  };

  for (const image of images) {
    const result = resultById.get(image.fileId);
    if (!result) {
      failures.push({
        fileId: image.fileId,
        expectedPath: image.relativePath,
        error: "页面没有返回该图片的下载结果。",
        attempts: []
      });
      continue;
    }
    if (result.ok) {
      const actualExtension = extensionByMime[result.mimeType];
      const relativePath = actualExtension
        ? image.relativePath.replace(/\.[A-Za-z0-9]{2,5}$/, `.${actualExtension}`)
        : image.relativePath;
      imagePaths[image.fileId] = relativePath;
      zipRoot.file(relativePath, result.base64, { base64: true });
      if (result.isPreview) {
        previewFallbacks.push({
          fileId: image.fileId,
          path: relativePath,
          originalSizeBytes: image.sizeBytes,
          previewSizeBytes: result.sizeBytes,
          note: "原图下载接口返回 403，已使用 ChatGPT Library 预览图补位。"
        });
      }
    } else {
      failures.push({
        fileId: result.fileId,
        expectedPath: image.relativePath,
        error: result.error,
        attempts: result.attempts
      });
    }
  }

  zipRoot.file(
    `${base}.md`,
    conversationToMarkdown(conversation, { imagePaths })
  );
  if (failures.length) {
    zipRoot.file("图片下载失败.json", JSON.stringify(failures, null, 2));
  }
  if (previewFallbacks.length) {
    zipRoot.file(
      "图片使用Library预览图.json",
      JSON.stringify(previewFallbacks, null, 2)
    );
  }
  return { images, failures, previewFallbacks };
}

function selectedFormats() {
  return [
    jsonFormat.checked ? "json" : null,
    mdFormat.checked ? "md" : null,
    txtFormat.checked ? "txt" : null
  ].filter(Boolean);
}

function setFinishedStatus(markdownResult, formatCount) {
  if (!markdownResult) {
    setStatus("ok", `文件已生成，请点击保存：${formatCount} 种格式。`);
    return;
  }
  const { images, failures, previewFallbacks } = markdownResult;
  if (failures.length) {
    setStatus(
      "error",
      `已打包，请点击保存；但 ${failures.length}/${images.length} 张图片下载失败；ZIP 内附错误报告。`
    );
  } else if (previewFallbacks.length) {
    setStatus(
      "ok",
      `文件已生成，请点击保存：${images.length - previewFallbacks.length} 张原图，${previewFallbacks.length} 张 Library 预览图。`
    );
  } else {
    setStatus(
      "ok",
      images.length
        ? `文件已生成，请点击保存：所选格式 + ${images.length} 张图片。`
        : "文件已生成，请点击保存：当前路径没有图片。"
    );
  }
}

async function downloadSelectedFormats() {
  if (!conversation || activeChatTabId === null) return;
  const formats = selectedFormats();
  if (formats.length === 0) {
    setStatus("error", "请至少选择一种导出格式。");
    return;
  }

  clearPreparedDownload();
  exportButton.disabled = true;
  try {
    const base = baseFilename();
    if (formats.length === 1 && formats[0] === "json") {
      downloadText(
        JSON.stringify(conversation),
        `${base}.json`,
        "application/json"
      );
      setStatus("ok", report?.branchTreeComplete === false
        ? "JSON 已生成：分页抢救结果，不含全部分支。请点击保存。"
        : "JSON 已生成：请点击保存。");
      return;
    }
    if (formats.length === 1 && formats[0] === "txt") {
      downloadText(conversationToText(conversation), `${base}.txt`, "text/plain");
      setStatus("ok", "TXT 已生成：记录当前路径，请点击保存。");
      return;
    }

    const zip = new globalThis.JSZip();
    const zipRoot = formats.length > 1 ? zip.folder(base) : zip;
    let markdownResult = null;
    if (formats.includes("json")) {
      zipRoot.file(`${base}.json`, JSON.stringify(conversation));
    }
    if (formats.includes("txt")) {
      zipRoot.file(`${base}.txt`, conversationToText(conversation));
    }
    if (formats.includes("md")) {
      markdownResult = await addMarkdownContents(zipRoot, base);
    }

    const blob = await zip.generateAsync({
      type: "blob",
      compression: "DEFLATE",
      compressionOptions: { level: 6 }
    });
    downloadBlob(
      blob,
      formats.length > 1 ? `${base}.zip` : `${base}（MD与图片）.zip`
    );
    setFinishedStatus(markdownResult, formats.length);
  } catch (error) {
    setStatus("error", `导出失败：${error?.message || String(error)}`);
  } finally {
    exportButton.disabled = false;
  }
}

readButton.addEventListener("click", () => readConversation());
fixedWindowButton.addEventListener("click", openWorkspace);
focusSourceButton.addEventListener("click", focusSourceTab);

if (workspaceMode) {
  extensionAPI.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (tabId !== workspaceSourceTabId) return;
    if (changeInfo.title || changeInfo.url) {
      try {
        assertChatGPTPage(tab.url);
        showSourceTab(tab);
      } catch {
        clearWorkspaceSource();
        setStatus("error", "此标签已离开 ChatGPT，请重新打开独立导出页。");
      }
    }
  });

  extensionAPI.tabs.onRemoved.addListener((tabId) => {
    if (tabId !== workspaceSourceTabId) return;
    clearWorkspaceSource();
    setStatus("error", "此标签已经关闭。已生成的文本或备份仍可保存。");
  });
}

readLinkButton.addEventListener("click", () => {
  readConversation(conversationReference.value);
});

conversationReference.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    readConversation(conversationReference.value);
  }
});

exportButton.addEventListener("click", downloadSelectedFormats);

reportButton.addEventListener("click", () => {
  const diagnostic = failureReport ?? report;
  if (!diagnostic) return;
  const filename = failureReport
    ? `ChatGPT读取失败诊断（${new Date().toISOString().slice(0, 10)}）.json`
    : `${baseFilename()}（诊断）.json`;
  downloadText(
    JSON.stringify(diagnostic, null, 2),
    filename,
    "application/json"
  );
  setStatus("ok", "诊断文件已生成，请点击保存。");
});
