import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

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
  execFileSync(process.execPath, [fileURLToPath(new URL("../build/build-userscript.mjs", import.meta.url))]);
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

test("embedded JSZip compresses and reopens a file", async () => {
  const start = script.indexOf("const JSZip = (() => {");
  const end = script.indexOf("\n    return module.exports;\n  })();", start);
  assert.ok(start >= 0 && end > start);
  const zipClass = new Function(script.slice(start, end) + "\n    return module.exports;\n  })();\nreturn JSZip;")();
  const zip = new zipClass();
  zip.file("test.txt", "hello");
  const bytes = await zip.generateAsync({type: "uint8array", compression: "DEFLATE"});
  const restored = await zipClass.loadAsync(bytes);
  assert.equal(await restored.file("test.txt").async("string"), "hello");
});
