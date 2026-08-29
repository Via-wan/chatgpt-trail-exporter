const HIDDEN_CONTENT_TYPES = new Set([
  "thoughts",
  "reasoning_recap",
  "model_editable_context",
  "user_editable_context",
  "tether_browsing_display",
  "tether_quote"
]);

export function conversationIdFromReference(value) {
  const reference = String(value ?? "").trim();
  if (!reference) {
    throw new Error("请粘贴 ChatGPT 对话链接或 conversation ID。");
  }

  let url = null;
  try {
    url = new URL(reference);
  } catch {
    // A raw conversation ID is handled below.
  }

  if (url) {
    if (!["chatgpt.com", "chat.openai.com"].includes(url.hostname)) {
      throw new Error("链接不是 chatgpt.com 的对话地址。");
    }
    const segments = url.pathname.split("/").filter(Boolean);
    const conversationMarker = segments.lastIndexOf("c");
    const conversationId = segments[conversationMarker + 1];
    if (conversationMarker < 0 || !conversationId) {
      throw new Error("链接中没有找到 /c/ 后面的 conversation ID。");
    }
    return conversationId;
  }

  if (/^[A-Za-z0-9_-]{8,}$/.test(reference)) {
    return reference;
  }
  throw new Error("无法识别该链接或 conversation ID。");
}

export function projectIdFromReference(value) {
  const reference = String(value ?? "").trim();
  let url = null;
  try {
    url = new URL(reference);
  } catch {
    return null;
  }
  if (!["chatgpt.com", "chat.openai.com"].includes(url.hostname)) {
    return null;
  }
  const segments = url.pathname.split("/").filter(Boolean);
  const projectMarker = segments.lastIndexOf("g");
  const projectId = segments[projectMarker + 1];
  return projectMarker >= 0 &&
    typeof projectId === "string" &&
    projectId.startsWith("g-p-")
    ? projectId
    : null;
}

export function getCurrentPath(conversation) {
  const mapping = conversation?.mapping;
  const currentNode = conversation?.current_node;

  if (!mapping || typeof mapping !== "object") {
    throw new Error("缺少 mapping，返回数据不是完整的 ChatGPT 对话树。");
  }
  if (!currentNode || !mapping[currentNode]) {
    throw new Error("current_node 不存在或未出现在 mapping 中。");
  }

  const reversed = [];
  const visited = new Set();
  let nodeId = currentNode;

  while (nodeId !== null && nodeId !== undefined) {
    if (visited.has(nodeId)) {
      throw new Error(`父链存在循环：${nodeId}`);
    }
    const node = mapping[nodeId];
    if (!node) {
      throw new Error(`父链引用了缺失节点：${nodeId}`);
    }
    visited.add(nodeId);
    reversed.push(nodeId);
    nodeId = node.parent;
  }

  return reversed.reverse();
}

export function buildPaginatedConversation(
  metadata,
  messagePages,
  conversationId,
  currentPathComplete = true
) {
  const messages = [];
  const seen = new Set();

  for (const page of messagePages) {
    for (const message of Array.isArray(page) ? page : []) {
      const messageId = message?.id;
      if (!messageId || seen.has(messageId)) {
        continue;
      }
      seen.add(messageId);
      messages.push(message);
    }
  }

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
  } = metadata && typeof metadata === "object" ? metadata : {};

  return {
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
      page_count: messagePages.length,
      message_count: messages.length,
      note: currentPathComplete
        ? "完整对话树接口失败；此文件由 ChatGPT 分页接口重建，仅保证当前路径，不包含未返回的隐藏分支。"
        : "完整对话树和后续分页读取均有失败；此文件只包含成功返回的路径片段。"
    }
  };
}

export function analyzeConversation(conversation) {
  const mapping = conversation?.mapping;
  if (!mapping || typeof mapping !== "object") {
    throw new Error("缺少 mapping，无法分析对话。");
  }

  const nodeEntries = Object.entries(mapping);
  const currentPath = getCurrentPath(conversation);
  const currentPathSet = new Set(currentPath);
  const roots = [];
  const missingParents = [];
  const missingChildren = [];
  const mismatchedChildren = [];
  const keyIdMismatches = [];
  const branchPoints = [];

  let messageNodes = 0;
  let hiddenNodes = 0;
  const roles = {};
  const contentTypes = {};

  for (const [nodeId, node] of nodeEntries) {
    if (node?.id !== nodeId) {
      keyIdMismatches.push({ nodeId, embeddedId: node?.id ?? null });
    }

    if (node?.parent === null || node?.parent === undefined) {
      roots.push(nodeId);
    } else if (!mapping[node.parent]) {
      missingParents.push({ nodeId, parent: node.parent });
    }

    const children = Array.isArray(node?.children) ? node.children : [];
    if (children.length > 1) {
      branchPoints.push({ nodeId, childCount: children.length });
    }
    for (const childId of children) {
      const child = mapping[childId];
      if (!child) {
        missingChildren.push({ nodeId, childId });
      } else if (child.parent !== nodeId) {
        mismatchedChildren.push({
          nodeId,
          childId,
          childParent: child.parent ?? null
        });
      }
    }

    const message = node?.message;
    if (!message) {
      continue;
    }
    messageNodes += 1;
    const role = message.author?.role ?? "unknown";
    const contentType = message.content?.content_type ?? "unknown";
    roles[role] = (roles[role] ?? 0) + 1;
    contentTypes[contentType] = (contentTypes[contentType] ?? 0) + 1;
    if (message.metadata?.is_visually_hidden_from_conversation) {
      hiddenNodes += 1;
    }
  }

  const structuralErrors =
    missingParents.length +
    missingChildren.length +
    mismatchedChildren.length +
    keyIdMismatches.length +
    (roots.length === 1 ? 0 : Math.abs(roots.length - 1));

  return {
    title: conversation.title || "未命名对话",
    conversationId: conversation.conversation_id ?? null,
    createTime: conversation.create_time ?? null,
    updateTime: conversation.update_time ?? null,
    model: conversation.default_model_slug ?? null,
    nodeCount: nodeEntries.length,
    messageNodeCount: messageNodes,
    currentPathNodeCount: currentPath.length,
    offCurrentPathNodeCount: nodeEntries.length - currentPathSet.size,
    branchPointCount: branchPoints.length,
    extraBranchCount: branchPoints.reduce(
      (sum, item) => sum + item.childCount - 1,
      0
    ),
    rootCount: roots.length,
    hiddenNodeCount: hiddenNodes,
    source: conversation?.trail_exporter?.source ?? "full_conversation",
    branchTreeComplete:
      conversation?.trail_exporter?.branch_tree_complete !== false,
    currentPathComplete:
      conversation?.trail_exporter?.current_path_complete !== false,
    rescue: conversation?.trail_exporter ?? null,
    roles,
    contentTypes,
    integrity: {
      ok: structuralErrors === 0,
      structuralErrorCount: structuralErrors,
      missingParents,
      missingChildren,
      mismatchedChildren,
      keyIdMismatches
    }
  };
}

function textFromValue(value) {
  if (typeof value === "string") {
    return value;
  }
  if (!value || typeof value !== "object") {
    return "";
  }
  if (typeof value.text === "string") {
    return value.text;
  }
  if (typeof value.content === "string") {
    return value.content;
  }
  return "";
}

function fileIdFromPointer(pointer) {
  if (typeof pointer !== "string") {
    return null;
  }
  const match = pointer.match(
    /^(?:sediment|file-service):\/\/(file_[A-Za-z0-9_-]+)$/
  );
  return match?.[1] ?? null;
}

function extensionFromMime(mimeType) {
  const extensions = {
    "image/avif": "avif",
    "image/gif": "gif",
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/svg+xml": "svg",
    "image/webp": "webp"
  };
  return extensions[mimeType] ?? "png";
}

function imageAssetsFromMessage(message) {
  const content = message?.content ?? {};
  const attachments = Array.isArray(message?.metadata?.attachments)
    ? message.metadata.attachments
    : [];
  const images = [];

  if (!Array.isArray(content.parts)) {
    return images;
  }

  for (const part of content.parts) {
    if (
      !part ||
      typeof part !== "object" ||
      part.content_type !== "image_asset_pointer"
    ) {
      continue;
    }

    const fileId = fileIdFromPointer(part.asset_pointer);
    if (!fileId) {
      continue;
    }

    const attachment = attachments.find((item) => item?.id === fileId);
    const mimeType =
      part.mime_type || attachment?.mime_type || "image/png";
    const originalName =
      attachment?.name ||
      message.metadata?.image_gen_title ||
      `image.${extensionFromMime(mimeType)}`;

    images.push({
      fileId,
      libraryFileId: attachment?.library_file_id ?? null,
      assetPointer: part.asset_pointer,
      mimeType,
      originalName,
      width: part.width ?? attachment?.width ?? null,
      height: part.height ?? attachment?.height ?? null,
      sizeBytes: part.size_bytes ?? attachment?.size ?? null
    });
  }

  return images;
}

function textPiecesFromContent(content) {
  const textPieces = [];
  if (Array.isArray(content.parts)) {
    for (const part of content.parts) {
      const text = textFromValue(part);
      if (text.trim()) {
        textPieces.push(text);
      }
    }
  }
  for (const key of ["text", "result", "code"]) {
    const text = textFromValue(content[key]);
    if (text.trim()) {
      textPieces.push(text);
    }
  }
  return textPieces;
}

export function extractTimelineItems(conversation) {
  const mapping = conversation.mapping;
  const path = getCurrentPath(conversation);
  const timeline = [];

  for (const nodeId of path) {
    const node = mapping[nodeId];
    const message = node?.message;
    if (!message) {
      continue;
    }

    const role = message.author?.role;
    const content = message.content ?? {};
    const contentType = content.content_type;
    const hidden = message.metadata?.is_visually_hidden_from_conversation;

    if (hidden || HIDDEN_CONTENT_TYPES.has(contentType)) {
      continue;
    }

    const images = imageAssetsFromMessage(message);
    const isConversationMessage = ["user", "assistant"].includes(role);
    const isVisibleToolImage = role === "tool" && images.length > 0;
    if (!isConversationMessage && !isVisibleToolImage) {
      continue;
    }

    const text = textPiecesFromContent(content).join("\n\n").trim();
    if (!text && images.length === 0) {
      continue;
    }

    timeline.push({
      nodeId,
      role: isVisibleToolImage ? "assistant" : role,
      kind: isVisibleToolImage ? "image" : "message",
      text,
      images,
      createTime: message.create_time ?? null,
      model: message.metadata?.model_slug ?? null,
      childCount: Array.isArray(node.children) ? node.children.length : 0
    });
  }

  return timeline;
}

export function extractVisibleMessages(conversation) {
  return extractTimelineItems(conversation).filter(
    (item) => item.kind === "message" && item.text
  );
}

export function collectCurrentPathImages(conversation) {
  const timeline = extractTimelineItems(conversation);
  const unique = new Map();

  for (const item of timeline) {
    for (const image of item.images) {
      if (!unique.has(image.fileId)) {
        unique.set(image.fileId, image);
      }
    }
  }

  const usedNames = new Set();
  return [...unique.values()].map((image, index) => {
    const fallbackExtension = extensionFromMime(image.mimeType);
    const cleanedOriginal = sanitizeFilename(image.originalName);
    const extensionMatch = cleanedOriginal.match(/\.([A-Za-z0-9]{2,5})$/);
    const originalExtension = extensionMatch?.[1]?.toLowerCase() ?? null;
    const normalizedOriginalExtension =
      originalExtension === "jpeg" ? "jpg" : originalExtension;
    const extensionMatchesMime =
      normalizedOriginalExtension === fallbackExtension;
    const stem = extensionMatch
      ? cleanedOriginal.slice(0, -extensionMatch[0].length)
      : cleanedOriginal;
    const baseName = extensionMatchesMime
      ? cleanedOriginal
      : `${stem}.${fallbackExtension}`;
    const prefix = String(index + 1).padStart(3, "0");
    let filename = `${prefix}-${baseName}`;
    let suffix = 2;
    while (usedNames.has(filename.toLowerCase())) {
      const dot = baseName.lastIndexOf(".");
      const stem = dot > 0 ? baseName.slice(0, dot) : baseName;
      const extension = dot > 0 ? baseName.slice(dot) : "";
      filename = `${prefix}-${stem}-${suffix}${extension}`;
      suffix += 1;
    }
    usedNames.add(filename.toLowerCase());
    return {
      ...image,
      filename,
      relativePath: `images/${filename}`
    };
  });
}

function formatTimestamp(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  const date = new Date(value * 1000);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date.toISOString();
}

export function conversationToMarkdown(conversation, options = {}) {
  const timeline = extractTimelineItems(conversation);
  const imagePaths = options.imagePaths ?? {};
  const exportedAt = options.exportedAt ?? new Date();
  const title = conversation.title || "未命名对话";
  const startDate = conversationStartDate(conversation);
  const lines = [
    "---",
    `title: ${JSON.stringify(title)}`,
    `conversation_id: ${JSON.stringify(conversation.conversation_id ?? "")}`,
    `started_at: ${JSON.stringify(startDate?.toISOString() ?? "")}`,
    `exported_at: ${JSON.stringify(exportedAt.toISOString())}`,
    "path: current",
    "---",
    "",
    `# ${title}`,
    ""
  ];

  for (const item of timeline) {
    const label =
      item.kind === "image"
        ? "ChatGPT 图片"
        : item.role === "user"
          ? "用户"
          : "ChatGPT";
    const timestamp = formatTimestamp(item.createTime);
    lines.push(`## ${label}${timestamp ? ` · ${timestamp}` : ""}`);
    lines.push("");
    if (item.text) {
      lines.push(item.text);
      lines.push("");
    }
    for (const image of item.images) {
      const imagePath = imagePaths[image.fileId] || `images/${image.fileId}.png`;
      const alt = sanitizeFilename(image.originalName).replace(/[[\]]/g, "");
      lines.push(`![${alt || "图片"}](${imagePath})`);
      lines.push("");
    }
    lines.push(`<!-- node:${item.nodeId} -->`);
    if (item.childCount > 1) {
      lines.push(`<!-- branch-point:${item.childCount} -->`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

export function conversationToText(conversation, options = {}) {
  const timeline = extractTimelineItems(conversation);
  const exportedAt = options.exportedAt ?? new Date();
  const title = conversation.title || "未命名对话";
  const startDate = conversationStartDate(conversation);
  const lines = [
    title,
    "=".repeat(Math.max(8, [...title].length)),
    `对话 ID：${conversation.conversation_id ?? ""}`,
    `窗口起始时间：${startDate?.toISOString() ?? "未知"}`,
    `导出时间：${exportedAt.toISOString()}`,
    "导出范围：当前路径（完整分支树请使用 JSON）",
    ""
  ];

  for (const item of timeline) {
    const label =
      item.kind === "image"
        ? "ChatGPT 图片"
        : item.role === "user"
          ? "用户"
          : "ChatGPT";
    const timestamp = formatTimestamp(item.createTime);
    lines.push(`【${label}${timestamp ? ` · ${timestamp}` : ""}】`);
    if (item.text) {
      lines.push(item.text);
    }
    for (const image of item.images) {
      const imageName = sanitizeFilename(image.originalName) || image.fileId;
      lines.push(`[图片：${imageName}；文件 ID：${image.fileId}]`);
    }
    if (item.childCount > 1) {
      lines.push(`[此处有 ${item.childCount} 个后续分支；当前 TXT 仅记录所选路径]`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

export function sanitizeFilename(value) {
  const cleaned = String(value || "chatgpt-conversation")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/g, "");
  return cleaned.slice(0, 120) || "chatgpt-conversation";
}

export function conversationStartDate(conversation) {
  if (
    typeof conversation?.create_time === "number" &&
    Number.isFinite(conversation.create_time)
  ) {
    return new Date(conversation.create_time * 1000);
  }

  const mapping = conversation?.mapping ?? {};
  const timestamps = Object.values(mapping)
    .map((node) => node?.message?.create_time)
    .filter((value) => typeof value === "number" && Number.isFinite(value));
  if (timestamps.length === 0) {
    return null;
  }
  return new Date(Math.min(...timestamps) * 1000);
}

export function formatLocalDate(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return "未知日期";
  }
  return `${date.getFullYear()}.${date.getMonth() + 1}.${date.getDate()}`;
}

export function conversationEndDate(conversation) {
  const visibleTimestamps = extractTimelineItems(conversation)
    .map((item) => item.createTime)
    .filter((value) => typeof value === "number" && Number.isFinite(value));
  if (visibleTimestamps.length > 0) {
    return new Date(Math.max(...visibleTimestamps) * 1000);
  }

  const mapping = conversation?.mapping ?? {};
  const pathTimestamps = getCurrentPath(conversation)
    .map((nodeId) => mapping[nodeId]?.message?.create_time)
    .filter((value) => typeof value === "number" && Number.isFinite(value));
  if (pathTimestamps.length > 0) {
    return new Date(Math.max(...pathTimestamps) * 1000);
  }

  if (
    typeof conversation?.update_time === "number" &&
    Number.isFinite(conversation.update_time)
  ) {
    return new Date(conversation.update_time * 1000);
  }
  return null;
}

export function datedBaseFilename(conversation) {
  const title = sanitizeFilename(conversation?.title || "chatgpt-conversation");
  const startDate = conversationStartDate(conversation);
  const endDate = conversationEndDate(conversation);
  return sanitizeFilename(
    `${title}（${formatLocalDate(startDate)}~${formatLocalDate(endDate)}）`
  );
}
