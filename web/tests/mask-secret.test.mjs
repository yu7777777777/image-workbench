import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";

function loadTypeScript(relativePath) {
  const source = readFileSync(new URL(relativePath, import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  });
  const exports = {};
  vm.runInNewContext(outputText, { exports });
  return exports;
}

const { maskSecretKey } = loadTypeScript("../src/lib/mask-secret.ts");

test("maskSecretKey masks short secrets completely without exposing single-character keys", () => {
  assert.equal(maskSecretKey(""), "");
  assert.equal(maskSecretKey("   "), "");
  assert.equal(maskSecretKey("1"), "••••••••");
  assert.equal(maskSecretKey("12345678"), "••••••••");
});

test("maskSecretKey keeps only short prefix and suffix for longer keys", () => {
  assert.equal(maskSecretKey("sk-1234567890xyz"), "sk-••••••xyz");
  assert.equal(maskSecretKey("  abcdef123456  "), "abc••••••456");
});
