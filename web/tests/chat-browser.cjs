// Run after `bun run build`. Uses only a loopback mock API and disposable browser profiles.
const { createServer } = require("node:http");
const { readFile, mkdir } = require("node:fs/promises");
const { resolve, extname, join } = require("node:path");
const assert = require("node:assert/strict");
const { chromium } = require(
  process.env.CHAT_PLAYWRIGHT_MODULE || "playwright",
);
const output = resolve("out");
const artifacts = resolve(
  process.env.CHAT_TEST_ARTIFACTS || "test-results/chat",
);
const requests = [];
const answer =
  '这是一段测试回答。\n\n## 计划\n\n- 分析问题\n- 整理思路\n\n| 项目 | 状态 |\n| --- | --- |\n| 流式聊天 | 可用 |\n\n```js\nconsole.log("你好");\n```';
const richReply = readFile(join(__dirname, "fixtures/chat-rich-reply.txt"), "utf8");
const observedReplies = require("./fixtures/chat-observed-replies.json");
const extendedReplies = require("./fixtures/chat-extended-replies.json");
const observedPrompts = new Map([
  ["检查公式和流程图", observedReplies.markdown_math_code],
  ["检查嵌套表单", observedReplies.writing_and_native_form],
  ["检查交互图表", observedReplies.visual_and_search],
  ["检查文件正文", observedReplies.downloadable_file],
  ...Object.entries(extendedReplies).map(([name, reply]) => [`检查 ${name}`, reply]),
]);
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost");
    if (url.pathname === "/auth/login")
      return res
        .writeHead(200, { "Content-Type": "application/json" })
        .end(
          JSON.stringify({
            ok: true,
            role: req.headers.authorization?.includes("admin")
              ? "admin"
              : "user",
            subject_id: req.headers.authorization?.includes("user-b")
              ? "user-b"
              : "user-a",
            name: "测试用户",
            version: "1.12.0",
          }),
        );
    if (url.pathname === "/v1/models")
      return res
        .writeHead(200, { "Content-Type": "application/json" })
        .end(
          JSON.stringify({ data: ["gpt-6-instant", "gpt-6-thinking", "gpt-6-pro", "gpt-5-6-instant", "gpt-5-6-thinking", "gpt-5-5-instant", "gpt-image-2"].map(id => ({ id })) }),
        );
    if (url.pathname === "/v1/chat/completions") {
      let body = "";
      for await (const chunk of req) body += chunk;
      const data = JSON.parse(body);
      requests.push(data);
      const last = data.messages.at(-1).content;
      const rich = last === "展示写作模板" || last === "展示其他表单" || observedPrompts.has(last);
      const reply = observedPrompts.get(last) ?? (rich ? await richReply : answer);
      const contentText = last === "展示其他表单" ? reply.replace("+kind+", "+window.location.href+") : reply;
      if (
        last === "失败测试" &&
        requests.filter((r) => r.messages.at(-1).content === "失败测试")
          .length === 1
      )
        return res
          .writeHead(429, { "Content-Type": "application/json" })
          .end(JSON.stringify({ error: { message: "测试限额不足" } }));
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
      });
      let index = 0;
      const slow = last === "停止测试" || last === "切换测试";
      const chunkSize = slow ? 2 : rich ? 17 : 12;
      const timer = setInterval(
        () => {
          const content = contentText.slice(index, index + chunkSize);
          index += chunkSize;
          res.write(
            `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`,
          );
          if (index >= contentText.length) {
            clearInterval(timer);
            res.end(
              'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
            );
          }
        },
        slow ? 180 : rich ? 15 : 35,
      );
      res.on("close", () => clearInterval(timer));
      return;
    }
    if (url.pathname.startsWith("/api/") || url.pathname === "/health")
      return res
        .writeHead(200, { "Content-Type": "application/json" })
        .end(JSON.stringify({ apps: [], version: "1.12.0" }));
    let pathname = decodeURIComponent(url.pathname);
    if (pathname.endsWith("/")) pathname += "index.html";
    else if (!extname(pathname)) pathname += "/index.html";
    const file = resolve(output, "." + pathname);
    if (!file.startsWith(output + require("node:path").sep))
      return res.writeHead(403).end();
    const bytes = await readFile(file);
    const type =
      {
        ".html": "text/html",
        ".js": "text/javascript",
        ".css": "text/css",
        ".json": "application/json",
        ".svg": "image/svg+xml",
      }[extname(file)] || "application/octet-stream";
    res.writeHead(200, { "Content-Type": type }).end(bytes);
  } catch {
    res.writeHead(404).end();
  }
});

async function seed(page, key = "mock-user-a") {
  await page.evaluate(async (key) => {
    const db = await new Promise((resolve, reject) => {
      const req = indexedDB.open("chatgpt2api");
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const tx = db.transaction("auth", "readwrite");
    const store = tx.objectStore("auth");
    store.put(key, "chatgpt2api_auth_key");
    store.put(
      {
        key,
        role: key.includes("admin") ? "admin" : "user",
        subjectId: key.includes("user-b") ? "user-b" : "user-a",
        name: "测试用户",
      },
      "chatgpt2api_auth_session",
    );
    await new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  }, key);
}
async function waitReady(page) {
  await page.getByRole("textbox", { name: "输入消息", exact: true }).waitFor();
}
async function send(page, text) {
  await page.getByRole("textbox", { name: "输入消息", exact: true }).fill(text);
  await page.getByRole("button", { name: "发送消息", exact: true }).click();
}
async function waitAnswer(page) {
  await page.getByRole("button", { name: "重新生成", exact: true }).waitFor();
}

async function checkRichReplies(page, context) {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await send(page, "展示写作模板");
  const writing = page.getByRole("region", { name: "写作块" });
  await writing.waitFor();
  assert(await writing.getByRole("button", { name: "复制正文" }).isDisabled());
  await waitAnswer(page);

  await page.getByRole("heading", { name: /你想学习哪一种提示词/ }).waitFor();
  await page.getByRole("cell", { name: "普通 Markdown" }).waitFor();
  assert.equal(await page.locator(".chat-code code").textContent(), "<WritingBlock>代码示例</WritingBlock>\n");
  assert(!(await page.locator(".chat-markdown").textContent()).includes("DIL.useState"));
  await page.locator(".chat-scroll").evaluate((el) => { el.scrollTop = 0; });
  await page.screenshot({ path: join(artifacts, "rich-reply-desktop.png") });
  await writing.getByRole("button", { name: "复制正文" }).click();
  await page.getByText("已复制正文", { exact: true }).waitFor();
  const clipboard = await page.evaluate(() => navigator.clipboard.readText());
  assert(clipboard.startsWith("你现在是一位专业的"));
  assert(!clipboard.includes("<WritingBlock"));

  await page.reload();
  await waitReady(page);
  await writing.waitFor();
  assert(await page.getByRole("radio", { name: "通用型 AI 提示词", exact: true }).isChecked());
  assert(await page.getByRole("radio", { name: "从零开始学习", exact: true }).isChecked());
  await page.setViewportSize({ width: 390, height: 844 });
  const form = page.locator(".chat-reply-form");
  await form.scrollIntoViewIfNeeded();
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: join(artifacts, "rich-reply-mobile.png") });

  await page.getByRole("radio", { name: "AI 绘画与图片生成", exact: true }).check();
  await page.getByRole("radio", { name: "会基础使用，想进阶", exact: true }).check();
  const followUp = "我想学习：AI 绘画与图片生成；我的水平：会基础使用，想进阶。请系统教我写高质量提示词，并提供实战案例和可复制模板。";
  await page.getByRole("button", { name: "开始学习" }).click();
  await page.getByText(followUp, { exact: true }).waitFor();
  await waitAnswer(page);
  assert.equal(requests.at(-1).messages.at(-1).content, followUp);

  await page.getByRole("button", { name: "新建对话", exact: true }).click();
  await send(page, "展示其他表单");
  await waitAnswer(page);
  const source = page.locator(".chat-reply-source");
  assert.equal(await source.getAttribute("open"), null);
  assert.equal(await page.getByRole("button", { name: "开始学习" }).count(), 0);
  await source.locator("summary").click();
  assert((await source.locator("pre").textContent()).includes("window.location.href"));
  await page.getByText("也可以直接输入你想学习的方向。", { exact: true }).waitFor();
}

async function checkObservedReplies(page) {
  async function ask(prompt) {
    await page.getByRole("button", { name: "新建对话", exact: true }).click();
    await send(page, prompt);
    await waitAnswer(page);
    assert.equal(await page.locator(".chat-reply-source:not(.chat-sources)").count(), 0);
  }

  await page.setViewportSize({ width: 1440, height: 1000 });
  await ask("检查公式和流程图");
  assert.equal(await page.locator(".chat-markdown .katex").count(), 2);
  const diagram = page.getByRole("img", { name: "Mermaid 图表" });
  await diagram.waitFor();
  await page.waitForFunction(() => {
    const image = document.querySelector(".chat-diagram img");
    return image?.complete && image.naturalWidth > 0;
  });
  assert((await diagram.boundingBox()).height < 300);
  await diagram.scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(artifacts, "observed-math-mermaid.png") });

  await ask("检查嵌套表单");
  await page.getByRole("radio", { name: /AI 编程提示词/ }).check();
  await page.getByRole("radio", { name: /进阶：/ }).check();
  await page.getByText("当前选择", { exact: true }).waitFor();
  assert.match(await page.locator(".chat-reply-form .chat-widget-box .chat-widget-box").innerText(), /学习方向：\s*编程[\s\S]*当前水平：\s*进阶/);
  await page.getByRole("button", { name: "开始学习" }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(artifacts, "observed-nested-form.png") });
  const followUp = page.waitForRequest((request) => request.url().endsWith("/v1/chat/completions") && request.method() === "POST");
  await page.getByRole("button", { name: "开始学习" }).click();
  assert.match((await followUp).postDataJSON().messages.at(-1).content, /学习方向：编程。\n当前水平：进阶。/);
  await waitAnswer(page);

  await page.setViewportSize({ width: 390, height: 844 });
  await ask("检查交互图表");
  const figure = page.getByRole("figure", { name: "数值" });
  await figure.waitFor();
  assert.equal(await figure.locator(".chat-chart-column strong").allTextContents().then((values) => values.join(",")), "1,2,3");
  await page.getByRole("slider", { name: "调整 A" }).fill("7");
  assert.equal(await figure.locator(".chat-chart-column strong").first().textContent(), "7");
  assert.match(await page.locator(".chat-widget").innerText(), /当前总和\s*12/);
  await page.getByRole("button", { name: "恢复初始数据" }).click();
  assert.equal(await figure.locator(".chat-chart-column strong").first().textContent(), "1");
  assert.equal(await page.getByRole("link", { name: /Example Domains —/ }).getAttribute("href"), "https://www.iana.org/help/example-domains");
  assert.equal(await page.getByRole("link", { name: "IANA — Example Domains 官方说明" }).count(), 0);
  assert((await page.getByText(/来源链接未返回/).count()) > 0);
  await page.locator(".chat-widget-chart").scrollIntoViewIfNeeded();
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: join(artifacts, "observed-chart-mobile.png") });

  await ask("检查文件正文");
  assert.equal(await page.getByRole("link", { name: /format-check.csv/ }).count(), 0);
  await page.getByText(/附件未返回/).waitFor();
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "下载 CSV 正文" }).click();
  const download = await pending;
  assert.equal(download.suggestedFilename(), "format-check.csv");
  assert.match(await readFile(await download.path(), "utf8"), /^\uFEFFitem,count\napple,1\npear,2\n$/);
}

async function checkExtendedReplies(page) {
  const message = () => page.locator(".chat-message.assistant").last();
  async function ask(name) {
    await page.getByRole("button", { name: "新建对话", exact: true }).click();
    await send(page, `检查 ${name}`);
    await waitAnswer(page);
    assert.equal(await message().locator(".chat-reply-source:not(.chat-sources)").count(), 0);
  }

  await page.setViewportSize({ width: 1914, height: 940 });
  await ask("citations");
  const messages = await page.locator(".chat-messages").boundingBox();
  const composer = await page.locator(".chat-composer").boundingBox();
  const contents = await message().boundingBox();
  assert(contents.width >= 1080 && messages.width >= 1100);
  assert(Math.abs(contents.x - composer.x) < 12);
  assert(Math.abs(contents.width - composer.width) < 12);
  const citations = message().getByRole("link", { name: "来源", exact: true });
  assert.deepEqual(await citations.evaluateAll((links) => links.map((link) => link.href)), ["https://www.iana.org/help/example-domains", "https://www.rfc-editor.org/info/rfc2606/"]);
  await message().getByText("回复中的来源链接（2）", { exact: true }).click();
  assert.equal(await message().locator(".chat-sources a").count(), 2);
  await page.screenshot({ path: join(artifacts, "extended-wide-sources.png") });
  await page.setViewportSize({ width: 1280, height: 900 });
  assert(Math.abs((await message().boundingBox()).x - (await page.locator(".chat-composer").boundingBox()).x) < 3);
  assert(await page.evaluate(() => document.documentElement.scrollWidth === innerWidth));

  await ask("attachments");
  for (const [language, filename, content] of [["CSV", "example.csv", "\uFEFFname,value\napple,1\n"], ["TXT", "example.txt", "hello\n"]]) {
    const pending = page.waitForEvent("download");
    await message().getByRole("button", { name: `下载 ${language} 正文` }).click();
    const download = await pending;
    assert.equal(download.suggestedFilename(), filename);
    assert.equal(await readFile(await download.path(), "utf8"), content);
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await ask("charts");
  assert.equal(await message().getByRole("figure", { name: "甲与乙的数据变化" }).locator("polyline").count(), 2);
  assert.equal(await message().getByRole("figure", { name: "水果数量分布" }).locator("li").count(), 3);
  const pie = message().getByRole("figure", { name: "当前水果数量占比" });
  await message().getByRole("slider", { name: "调整 APPLE", exact: true }).fill("7");
  assert.match(await pie.locator("li").first().innerText(), /苹果\s*7/);
  await message().getByRole("button", { name: "增加 apple", exact: true }).click();
  assert.match(await pie.locator("li").first().innerText(), /苹果\s*8/);
  await message().getByRole("button", { name: "恢复初始数据" }).click();
  assert.match(await pie.locator("li").first().innerText(), /苹果\s*2/);
  await pie.scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(artifacts, "extended-mobile-chart.png") });
  for (const name of ["APPLE", "PEAR", "BANANA"]) await message().getByRole("slider", { name: `调整 ${name}`, exact: true }).fill("0");
  await message().getByText("所有数量均为 0，暂无饼图数据。", { exact: true }).waitFor();
  assert(await page.evaluate(() => document.documentElement.scrollWidth === innerWidth));

  await ask("controls");
  await message().getByRole("checkbox", { name: /博物馆/ }).check();
  await message().locator("select").selectOption("秋季");
  const followUp = page.waitForRequest((request) => request.url().endsWith("/v1/chat/completions") && request.method() === "POST");
  await message().getByRole("button", { name: "确认并发送" }).click();
  assert.match((await followUp).postDataJSON().messages.at(-1).content, /感兴趣的地点：博物馆\n偏好的季节：秋季/);
  await waitAnswer(page);

  await page.setViewportSize({ width: 1440, height: 1000 });
  await ask("writing_code");
  const writing = message().getByRole("region", { name: "写作块" });
  await writing.getByRole("button", { name: "编辑", exact: true }).click();
  await writing.getByRole("textbox", { name: "编辑写作块" }).fill("保存后的现场样稿");
  await writing.getByRole("button", { name: "保存", exact: true }).click();
  await writing.getByText("保存后的现场样稿", { exact: true }).waitFor();
  const savedDraft = await page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const req = indexedDB.open("chatgpt2api");
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    try {
      return await new Promise((resolve, reject) => {
        const req = db.transaction("chat_conversations").objectStore("chat_conversations").get("user:user-a");
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
          const snapshot = req.result;
          const thread = snapshot?.threads.find((item) => item.id === snapshot.activeId);
          resolve({ title: thread?.title, drafts: thread?.messages.at(-1)?.writingDrafts });
        };
      });
    } finally {
      db.close();
    }
  });
  assert.deepEqual(Object.values(savedDraft.drafts ?? {}), ["保存后的现场样稿"], JSON.stringify(savedDraft));
  await page.reload();
  await waitReady(page);
  await writing.getByText("保存后的现场样稿", { exact: true }).waitFor();
  const blocks = message().locator(".chat-code");
  for (const [index, lang, component] of [[0, "HTML", "div"], [1, "JSX", "div"], [2, "SVG", "circle"]]) {
    await blocks.nth(index).getByRole("button", { name: "预览", exact: true }).click();
    const frame = blocks.nth(index).locator(`iframe[title="${lang} 静态预览"]`);
    assert.equal(await frame.getAttribute("sandbox"), "");
    await frame.contentFrame().locator(component).waitFor();
  }
  await blocks.nth(3).getByRole("button", { name: "预览", exact: true }).click();
  await blocks.nth(3).getByRole("figure", { name: "Vega-Lite 图表" }).waitFor();
  await blocks.nth(3).scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(artifacts, "extended-code-previews.png") });
  assert.equal(await blocks.nth(4).getByRole("button", { name: "预览", exact: true }).count(), 0);

  await ask("tools");
  await message().getByText("商品信息未返回", { exact: true }).first().waitFor();
  await message().getByText("图片未返回", { exact: true }).first().waitFor();
  assert(!(await message().innerText()).includes("sampleproduct"));
}

(async () => {
  await mkdir(artifacts, { recursive: true });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.CHAT_BROWSER_PATH
      ? { executablePath: process.env.CHAT_BROWSER_PATH }
      : {}),
  });
  try {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(base + "/login/");
    await page.getByRole("button", { name: /登录/ }).first().waitFor();
    await seed(page);
    await page.goto(base + "/chat/");
    await waitReady(page);
    await page.emulateMedia({ reducedMotion: "reduce" });
    if (process.argv.includes("--rich-replies")) {
      await checkRichReplies(page, context);
      await checkObservedReplies(page);
      assert.deepEqual(errors, []);
      console.log(JSON.stringify({ ok: true, cases: ["streamed-rich-reply", "reload-form", "radio-follow-up", "source-fallback", "observed-math-mermaid", "observed-nested-form", "observed-chart-references", "observed-csv"], requests: requests.length, artifacts }));
      return;
    }
    if (process.argv.includes("--extended-replies")) {
      await checkExtendedReplies(page);
      assert.deepEqual(errors, []);
      console.log(JSON.stringify({ ok: true, cases: ["wide-layout", "citations", "attachments", "multi-series-and-interactive-pie", "checkbox-select-submit", "writing-edit-reload", "isolated-previews", "tool-card-fallbacks"], requests: requests.length, artifacts }));
      return;
    }
    await page.screenshot({ path: join(artifacts, "desktop-empty.png") });
    await page.getByRole("combobox", { name: "选择对话模型" }).click();
    assert.equal(
      await page
        .getByRole("option", { name: "gpt-image-2", exact: true })
        .count(),
      0,
    );
    assert.equal(await page.getByRole("option").count(), 3);
    await page.getByRole("option", { name: "GPT-5.6 Sol", exact: true }).click();
    await send(page, "帮我梳理一个想法");
    await waitAnswer(page);
    assert.equal(requests.at(-1).model, "gpt-5-6-instant");
    assert.equal(requests.at(-1).stream, true);
    assert.equal(requests.at(-1).reasoning_effort, undefined);
    assert.equal(await page.locator(".chat-markdown table").count(), 1);
    await page.getByRole("button", { name: "复制代码", exact: true }).click();
    await page.getByText("已复制", { exact: true }).waitFor();
    await page.screenshot({ path: join(artifacts, "desktop-answer.png") });
    await page.reload();
    await waitReady(page);
    await waitAnswer(page);
    assert.equal(
      await page.locator(".chat-user-text").textContent(),
      "帮我梳理一个想法",
    );
    await page
      .getByRole("button", { name: "重命名 帮我梳理一个想法", exact: true })
      .click();
    await page.getByRole("textbox", { name: "对话名称" }).fill("历史保留测试");
    await page.getByRole("button", { name: "保存", exact: true }).click();
    await page.getByRole("textbox", { name: "搜索对话" }).fill("不存在");
    assert.equal(await page.getByText("没有找到相关对话").count(), 1);
    await page.getByRole("textbox", { name: "搜索对话" }).fill("");
    await page.getByRole("combobox", { name: "选择思考程度" }).click();
    assert.equal(await page.getByRole("option", { name: "Pro", exact: true }).getAttribute("aria-disabled"), "true");
    await page.keyboard.press("Escape");
    await page.getByRole("combobox", { name: "选择对话模型" }).click();
    await page.getByRole("option", { name: "GPT-6", exact: true }).click();
    for (const [label, model, effort] of [
      ["中", "gpt-6-thinking", "standard"],
      ["高", "gpt-6-thinking", "extended"],
      ["极高 · Pro 账号", "gpt-6-thinking", "max"],
      ["Pro", "gpt-6-pro", undefined],
      ["即时", "gpt-6-instant", undefined],
    ]) {
      await page.getByRole("combobox", { name: "选择思考程度" }).click();
      await page.getByRole("option", { name: label, exact: true }).click();
      await send(page, `参数测试 ${label}`);
      await waitAnswer(page);
      assert.equal(requests.at(-1).model, model);
      assert.equal(requests.at(-1).reasoning_effort, effort);
    }
    await page.getByRole("combobox", { name: "选择对话模型" }).click();
    await page.getByRole("option", { name: "GPT-5.6 Sol", exact: true }).click();
    await page
      .getByRole("button", { name: "新建对话", exact: true })
      .first()
      .click();
    await page.getByRole("button", { name: "对话设置" }).click();
    await page
      .getByPlaceholder("例如：请用简洁的中文回答。")
      .fill("用中文回答");
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Close", exact: true })
      .click();
    await page.getByRole("combobox", { name: "选择思考程度" }).click();
    await page.getByRole("option", { name: "高", exact: true }).click();
    await send(page, "停止测试");
    await page.getByText("正在回复", { exact: true }).waitFor();
    await page.getByRole("button", { name: "停止生成" }).click();
    await page.getByText("已停止 · 已保留收到的内容").waitFor();
    assert.equal(requests.at(-1).reasoning_effort, "extended");
    assert.equal(requests.at(-1).model, "gpt-5-6-thinking");
    assert.equal(requests.at(-1).messages[0].role, "system");
    await page
      .getByRole("button", { name: "新建对话", exact: true })
      .first()
      .click();
    await send(page, "失败测试");
    await page.getByText("测试限额不足").waitFor();
    await page.getByRole("button", { name: "重试", exact: true }).click();
    await waitAnswer(page);
    assert.equal(requests.at(-1).messages.length, 1);
    assert(requests.at(-1).metadata.chat_retry_id);
    await page
      .getByRole("button", { name: "新建对话", exact: true })
      .first()
      .click();
    await send(page, "切换测试");
    await page.getByText("正在回复", { exact: true }).waitFor();
    await page
      .getByRole("button", { name: "新建对话", exact: true })
      .first()
      .click();
    await page.getByText("另一段对话正在回复。", { exact: false }).waitFor();
    assert.equal(await page.locator(".chat-message").count(), 0);
    await page.getByRole("button", { name: "停止回复", exact: true }).click();
    // Image input + request structure.
    await page
      .locator("input[type=file]")
      .setInputFiles({
        name: "test.png",
        mimeType: "image/png",
        buffer: Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
          "base64",
        ),
      });
    await page.locator(".chat-attachments img").waitFor();
    await page.getByRole("button", { name: "发送消息", exact: true }).click();
    await waitAnswer(page);
    assert.equal(requests.at(-1).messages[0].content[1].type, "image_url");
    // Explicit IME composition must not submit.
    await page
      .getByRole("textbox", { name: "输入消息", exact: true })
      .fill("中文输入");
    const before = requests.length;
    await page
      .getByRole("textbox", { name: "输入消息", exact: true })
      .dispatchEvent("keydown", { key: "Enter", isComposing: true });
    assert.equal(requests.length, before);
    await page.evaluate(() => document.documentElement.classList.add("dark"));
    await page.screenshot({ path: join(artifacts, "desktop-dark.png") });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: join(artifacts, "mobile.png") });
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    const composer = await page.locator(".chat-composer").boundingBox();
    assert(composer.y + composer.height <= 844);
    await page.getByRole("button", { name: "打开对话历史" }).click();
    await page.getByRole("dialog").waitFor();
    await page.screenshot({ path: join(artifacts, "mobile-history.png") });
    await page.keyboard.press("Escape");
    // User A's history must never appear for user B, but must survive a switch back.
    await seed(page, "mock-user-b");
    await page.reload();
    await waitReady(page);
    assert.equal(await page.locator(".chat-message").count(), 0);
    assert.equal(
      await page.getByRole("button", { name: /历史保留测试/ }).count(),
      0,
    );
    await seed(page);
    await page.reload();
    await waitReady(page);
    assert((await page.locator(".chat-message").count()) > 0);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page
      .getByRole("button", { name: "删除 历史保留测试", exact: true })
      .click();
    await page.getByRole("button", { name: "删除", exact: true }).click();
    assert.equal(
      await page
        .getByRole("button", { name: "删除 历史保留测试", exact: true })
        .count(),
      0,
    );
    await seed(page, "mock-admin");
    await page.reload();
    await waitReady(page);
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.screenshot({ path: join(artifacts, "admin-tablet.png") });
    assert(
      await page
        .getByRole("button", { name: "打开导航", exact: true })
        .isVisible(),
    );
    await page.setViewportSize({ width: 1280, height: 800 });
    const navBox = await page.locator("header nav").boundingBox();
    const accountBox = await page
      .getByRole("button", { name: /测试用户 管理员/ })
      .boundingBox();
    assert(navBox && accountBox && navBox.x + navBox.width < accountBox.x);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.screenshot({ path: join(artifacts, "admin-desktop.png") });
    // Old raw-model threads remain readable, but require explicit selection.
    await page.evaluate(async () => {
      const db = await new Promise((resolve, reject) => {
        const req = indexedDB.open("chatgpt2api");
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      const tx = db.transaction("chat_conversations", "readwrite");
      tx.objectStore("chat_conversations").put({
        activeId: "legacy", lastModel: "gpt-5-6",
        threads: [{ id: "legacy", title: "旧模型", updatedAt: Date.now(), model: "gpt-5-6", effort: "", system: "", messages: [{ id: "old", role: "assistant", text: "保留的历史", model: "gpt-5-6", status: "done" }] }],
      }, "admin:user-a");
      await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = reject; });
      db.close();
    });
    await page.reload();
    await waitReady(page);
    await page.getByText("保留的历史", { exact: true }).waitFor();
    await page.getByText(/历史模型设置已保留/).waitFor();
    await page.getByRole("textbox", { name: "输入消息", exact: true }).fill("旧模型不应自动发送");
    assert(await page.getByRole("button", { name: "发送消息", exact: true }).isDisabled());
    assert(await page.getByRole("button", { name: "重新生成", exact: true }).isDisabled());
    await page.getByRole("combobox", { name: "选择对话模型" }).click();
    await page.getByRole("option", { name: "GPT-5.5", exact: true }).click();
    await send(page, "明确改选模型");
    await waitAnswer(page);
    assert.equal(requests.at(-1).model, "gpt-5-5-instant");
    await page.route("**/v1/models", route => route.fulfill({ status: 500, body: "{}" }));
    await page.reload();
    await waitReady(page);
    await page.getByText("模型列表加载失败，请点击重试。", { exact: true }).waitFor();
    await page.getByRole("textbox", { name: "输入消息", exact: true }).fill("目录失败不应发送");
    assert(await page.getByRole("button", { name: "发送消息", exact: true }).isDisabled());
    await page.unroute("**/v1/models");
    await page.getByText("模型列表加载失败，请点击重试。", { exact: true }).click();
    await page.getByText("模型列表加载失败，请点击重试。", { exact: true }).waitFor({ state: "hidden" });
    assert.deepEqual(errors, []);
    console.log(
      JSON.stringify({
        ok: true,
        cases: [
          "model-filter",
          "stream-markdown",
          "reload-history",
          "rename-search-delete",
          "stop",
          "error-retry",
          "switch-during-stream",
          "image-input",
          "ime",
          "mobile-layout",
          "user-isolation",
        ],
        requests: requests.length,
        artifacts,
      }),
    );
    await context.close();
  } finally {
    await browser.close();
    server.close();
  }
})().catch((e) => {
  console.error(e);
  server.close();
  process.exitCode = 1;
});
