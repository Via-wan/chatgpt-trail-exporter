import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const manifest = JSON.parse(readFileSync(new URL("../manifest.json", import.meta.url), "utf8"));
const script = readFileSync(new URL("../popup.js", import.meta.url), "utf8");
const popup = readFileSync(new URL("../popup.html", import.meta.url), "utf8");
const workspace = readFileSync(new URL("../sidepanel.html", import.meta.url), "utf8");

test("Safari manifest keeps scoped permissions and no Chrome side panel", () => {
  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual(manifest.permissions, ["activeTab", "scripting"]);
  assert.deepEqual(manifest.host_permissions, ["https://chatgpt.com/*", "https://chat.openai.com/*"]);
  assert.equal(manifest.side_panel, undefined);
  assert.equal(manifest.minimum_chrome_version, undefined);
  assert.doesNotMatch(script, /\.sidePanel\./);
});

test("Both interfaces expose explicit download links", () => {
  assert.match(popup, /id="save-link"/);
  assert.match(workspace, /id="save-link"/);
});

function harness(pathname = "/popup.html", search = "") {
  const elements = new Map(), calls = [], revoked = [];
  const element = (selector) => {
    if (!elements.has(selector)) {
      const classes = new Set(["hidden"]);
      elements.set(selector, {
        classList: { add: (...names) => names.forEach(n => classes.add(n)), remove: (...names) => names.forEach(n => classes.delete(n)), contains: n => classes.has(n) },
        addEventListener() {}, removeAttribute(name) { delete this[name]; }
      });
    }
    return elements.get(selector);
  };
  const tab = { id: 17, url: "https://chatgpt.com/c/test", title: "test" };
  const api = {
    tabs: {
      query: async () => [tab],
      get: async (id) => { calls.push(["get", id]); return tab; },
      create: async (options) => { calls.push(["create", options]); return { id: 18 }; },
      onUpdated: { addListener() {} },
      onRemoved: { addListener() {} }
    },
    runtime: { getURL: path => "safari-web-extension://example/" + path }
  };
  let urlCount = 0;
  class MockURL extends URL {
    static createObjectURL() { return "blob:mock/" + (++urlCount); }
    static revokeObjectURL(url) { revoked.push(url); }
  }
  const code = script.replace(/^import\s*\{[\s\S]*?\}\s*from\s*"\.\/lib\/conversation\.js";\s*/, "");
  const create = new Function("globalThis", "document", "window", "URL", "URLSearchParams",
    code + "\nreturn { sourceTabIdFromSearch, mainFrameResult, openWorkspace, getSourceChatTab, downloadBlob, clearPreparedDownload };");
  const functions = create({browser: api}, {querySelector: element, body: element("body")}, {location: {pathname, search}}, MockURL, URLSearchParams);
  return { functions, calls, revoked, element };
}

test("source-tab parsing rejects missing, malformed and unsafe IDs", () => {
  const { functions: f } = harness();
  assert.equal(f.sourceTabIdFromSearch("?sourceTabId=17"), 17);
  assert.equal(f.sourceTabIdFromSearch("?sourceTabId=0"), 0);
  for (const query of ["", "?sourceTabId=-1", "?sourceTabId=1e3", "?sourceTabId=9007199254740992"]) {
    assert.throws(() => f.sourceTabIdFromSearch(query));
  }
});

test("open workspace with source ID and read it rather than active tab", async () => {
  const popupHarness = harness();
  await popupHarness.functions.openWorkspace();
  assert.deepEqual(popupHarness.calls, [["create", {url: "safari-web-extension://example/sidepanel.html?sourceTabId=17", active: true}]]);
  const workspaceHarness = harness("/sidepanel.html", "?sourceTabId=17");
  await Promise.resolve();
  const tab = await workspaceHarness.functions.getSourceChatTab();
  assert.equal(tab.id, 17);
  assert.deepEqual(workspaceHarness.calls, [["get", 17], ["get", 17]]);
});

test("injection handles missing and failed results", () => {
  const { functions: f } = harness();
  assert.deepEqual(f.mainFrameResult([{frameId: 3, result: "other"}, {frameId: 0, result: {ok: true}}]), {ok: true});
  assert.throws(() => f.mainFrameResult([]));
  assert.throws(() => f.mainFrameResult([{frameId: 0, error: "denied"}]), /denied/);
});

test("prepare a clickable file and revoke only the replaced URL", () => {
  const { functions: f, element, revoked } = harness();
  const link = element("#save-link");
  f.downloadBlob({}, "test.json");
  assert.equal(link.href, "blob:mock/1");
  assert.equal(link.download, "test.json");
  assert.equal(link.classList.contains("hidden"), false);
  f.downloadBlob({}, "test.zip");
  assert.deepEqual(revoked, ["blob:mock/1"]);
  f.clearPreparedDownload();
  assert.deepEqual(revoked, ["blob:mock/1", "blob:mock/2"]);
  assert.equal(link.classList.contains("hidden"), true);
});
