import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";

const require = createRequire(import.meta.url);
function loadTypeScript(relativePath, imports = {}, globals = {}) {
  const source = readFileSync(new URL(relativePath, import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  });
  const exports = {};
  vm.runInNewContext(outputText, {
    exports,
    require: (name) => Object.hasOwn(imports, name) ? imports[name] : require(name),
    ...globals,
  });
  return exports;
}
const concurrency = loadTypeScript("../src/lib/image-concurrency.ts");

// Execute the real store with local API/toast mocks: no server or credentials needed.
function createStore(serverConfig) {
  const payloads = [];
  const errors = [];
  const events = [];
  const { useSettingsStore: store } = loadTypeScript("../src/app/settings/store.ts", {
    "@/lib/image-concurrency": concurrency,
    "@/lib/api": {
      fetchSettingsConfig: async () => ({ config: serverConfig }),
      updateSettingsConfig: async (payload) => {
        payloads.push(payload);
        return { config: payload };
      },
    },
    sonner: { toast: { error: (message) => errors.push(message), success: () => {} } },
  }, { window: { dispatchEvent: (event) => events.push(event.type) }, Event });
  return { store, payloads, errors, events };
}

test("GET hydration defaults to true/2 but preserves explicit false and bounds", async () => {
  for (const [fields, expectedParallel, expectedLimit] of [
    [{}, true, 2],
    [{ image_parallel_generation: false, image_task_concurrency: 8 }, false, 8],
    [{ image_parallel_generation: true, image_task_concurrency: 1 }, true, 1],
  ]) {
    const { store } = createStore({ proxy: "", ...fields });
    await store.getState().loadConfig();
    assert.equal(store.getState().config.image_parallel_generation, expectedParallel);
    assert.equal(store.getState().config.image_task_concurrency, expectedLimit);
  }
});

test("toggle preserves the limit; common save sends boolean + integer and retains other fields", async () => {
  const { store, payloads, events } = createStore({
    proxy: "", image_parallel_generation: false, image_task_concurrency: 6,
    image_account_concurrency: 3, unrelated_setting: "keep",
  });
  await store.getState().loadConfig();
  store.getState().setImageParallelGeneration(true);
  assert.equal(store.getState().config.image_task_concurrency, 6);
  store.getState().setImageTaskConcurrency("8");
  store.getState().setImageParallelGeneration(false);
  assert.equal(await store.getState().saveConfig(), true);
  assert.equal(payloads.length, 1);
  assert.equal(payloads[0].image_parallel_generation, false);
  assert.equal(payloads[0].image_task_concurrency, 8);
  assert.equal(typeof payloads[0].image_task_concurrency, "number");
  assert.equal(payloads[0].image_account_concurrency, 3);
  assert.equal(payloads[0].unrelated_setting, "keep");
  assert.equal(store.getState().config.image_task_concurrency, 8);
  assert.equal(store.getState().config.image_parallel_generation, false);
  assert.equal(events.length, 1);
  store.getState().setImageParallelGeneration(true);
  store.getState().setImageTaskConcurrency("1");
  assert.equal(await store.getState().saveConfig(), true);
  assert.equal(payloads[1].image_parallel_generation, true);
  assert.equal(payloads[1].image_task_concurrency, 1);
});

test("empty, fractional, out-of-range and nonfinite drafts never reach POST, even while disabled", async () => {
  for (const parallel of [true, false]) {
    const { store, payloads, errors } = createStore({ proxy: "", image_parallel_generation: parallel });
    await store.getState().loadConfig();
    for (const draft of ["", " ", "0", "9", "-1", "1.5", "NaN", "Infinity", "1e0", "abc"]) {
      store.getState().setImageTaskConcurrency(draft);
      assert.equal(await store.getState().saveConfig(), false, draft);
      assert.equal(store.getState().isSavingConfig, false);
    }
    assert.equal(payloads.length, 0);
    assert.equal(errors.length, 10);
  }
  for (const invalid of [NaN, Infinity, null, undefined, true, {}, []]) {
    assert.equal(concurrency.parseImageTaskConcurrency(invalid), null);
  }
});

test("controls retain accessibility, disabled-state and task-only scope explanations", () => {
  const source = readFileSync(new URL("../src/app/settings/components/config-card.tsx", import.meta.url), "utf8");
  assert.match(source, /htmlFor="image-task-concurrency"/);
  assert.match(source, /aria-invalid={imageTaskConcurrencyInvalid}/);
  assert.match(source, /disabled={config\?\.image_parallel_generation === false}/);
  assert.match(source, /逐张串行生成/);
  assert.match(source, /不是单账号限制，也不是全站总并发/);
  const page = readFileSync(new URL("../src/app/settings/page.tsx", import.meta.url), "utf8");
  assert.match(page, /void initialize\(\)/);
  assert.match(page, /<ConfigCard \/>/);
});
