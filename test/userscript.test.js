import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const path = new URL("../chatgpt-trail-exporter.user.js", import.meta.url);
const script = readFileSync(path, "utf8");

test("standalone userscript metadata, no remote dependency or browser extension APIs", () => {
  assert.match(script, /\/\/ @match\s+https:\/\/chatgpt\.com\/\*/);
  assert.match(script, /\/\/ @match\s+https:\/\/chat\.openai\.com\/\*/);
  assert.match(script, /\/\/ @inject-into\s+content/);
  assert.match(script, /\/\/ @grant\s+none/);
  assert.doesNotMatch(script, /^\/\/ @require\s/m);
  assert.doesNotMatch(script, /extensionAPI\.scripting|chrome\.scripting|browser\.scripting/);
  assert.doesNotThrow(() => new Function(script));
});

test("bundled script is reproducible", () => {
  execFileSync(process.execPath, [new URL("../build/build-userscript.mjs", import.meta.url).pathname]);
  assert.equal(readFileSync(path, "utf8"), script);
});

test("script contains all export and rescue paths and explicit save link", () => {
  for (const name of ["fetchConversationFromPage", "fetchFilesFromPage", "conversationToMarkdown", "conversationToText", "addMarkdownContents", "downloadSelectedFormats", "clearPreparedDownload", "paginated_rescue"]) {
    assert.ok(script.includes(name), name);
  }
  assert.match(script, /new JSZip\(\)/);
  assert.match(script, /saveLink\.download = filename/);
  assert.match(script, /credentials: "omit", headers: \{\}, referrerPolicy: "no-referrer"/);
});
