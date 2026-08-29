import test from "node:test";
import assert from "node:assert/strict";

import {
  conversationToMarkdown,
  conversationToText,
  conversationEndDate,
  datedBaseFilename
} from "../lib/conversation.js";

const conversation = {
  title: "示例对话",
  conversation_id: "conversation-test",
  create_time: new Date(2026, 6, 23, 9, 0, 0).getTime() / 1000,
  current_node: "assistant-1",
  mapping: {
    root: {
      id: "root",
      parent: null,
      children: ["user-1"],
      message: null
    },
    "user-1": {
      id: "user-1",
      parent: "root",
      children: ["assistant-1", "hidden-branch"],
      message: {
        id: "user-1",
        author: { role: "user" },
        create_time: new Date(2026, 6, 23, 9, 1, 0).getTime() / 1000,
        content: { content_type: "text", parts: ["你好"] },
        metadata: {}
      }
    },
    "assistant-1": {
      id: "assistant-1",
      parent: "user-1",
      children: [],
      message: {
        id: "assistant-1",
        author: { role: "assistant" },
        create_time: new Date(2026, 6, 23, 9, 2, 0).getTime() / 1000,
        content: { content_type: "text", parts: ["你好，这是导出测试。"] },
        metadata: {}
      }
    },
    "hidden-branch": {
      id: "hidden-branch",
      parent: "user-1",
      children: [],
      message: {
        id: "hidden-branch",
        author: { role: "assistant" },
        create_time: new Date(2026, 6, 30, 9, 2, 0).getTime() / 1000,
        content: { content_type: "text", parts: ["另一个分支"] },
        metadata: {}
      }
    }
  }
};

test("TXT exports the current path and labels branch points honestly", () => {
  const text = conversationToText(conversation, {
    exportedAt: new Date(2026, 6, 29, 20, 0, 0)
  });
  assert.match(text, /导出范围：当前路径/);
  assert.match(text, /【用户/);
  assert.match(text, /你好，这是导出测试。/);
  assert.match(text, /此处有 2 个后续分支/);
  assert.doesNotMatch(text, /另一个分支/);
});

test("Markdown remains explicitly current-path only", () => {
  const markdown = conversationToMarkdown(conversation);
  assert.match(markdown, /path: current/);
  assert.doesNotMatch(markdown, /另一个分支/);
});

test("conversation end date follows the last visible message on the current path", () => {
  assert.equal(
    conversationEndDate(conversation)?.getTime(),
    new Date(2026, 6, 23, 9, 2, 0).getTime()
  );
});

test("dated filename includes the window start and end dates", () => {
  assert.equal(
    datedBaseFilename(conversation),
    "示例对话（2026.7.23~2026.7.23）"
  );
});
