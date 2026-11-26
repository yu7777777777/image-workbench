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
const expandedWidgets = require("./fixtures/chat-widget-expansion.json");
const componentPlayground = readFile(join(__dirname, "fixtures/chat-component-playground.txt"), "utf8");
const compatibilityReply = readFile(join(__dirname, "fixtures/chat-widget-compatibility.txt"), "utf8");
const compatibilityMode = process.argv.includes("--widget-compatibility");
const compatibilityPrompt = "检查截图组件";
const radioDefaultPrompt = "检查单选默认值";
const radioDefaultReply = readFile(join(__dirname, "fixtures/chat-widget-radio-default.txt"), "utf8");
const tablesAndMenusPrompt = "检查列表表格和菜单";
const tablesAndMenusReply = readFile(join(__dirname, "fixtures/chat-widget-tables-and-menus.txt"), "utf8");
const imageQueries = ["园区 游戏地图", "装备背包", "园区战斗"];
const imageReply = `## 资源路线

<box gap={3}>
  <row align=start gap={3}>
    <AsyncImage query="监控室 游戏地图" aspectRatio="1:1" maxWidth="112px"/>
    <box flex="1" gap={1}>**路线 A**\n<badge color="success">潜能优先</badge>\n- 查看地图</box>
  </row>
  <divider color="subtle"/>
  <row align=start gap={3}>
    <AsyncImage query="没有返回的图"/>
    <box flex="1">**路线 B**</box>
  </row>
</box>

<box border radius="lg" padding={3} gap={3}>
  <title>每日循环</title>
  <list connector="solid" marker="number" gap={3}>
    <list-item>**第一轮**\n\n收集材料。</list-item>
    <list-item>**第二轮**\n\n整理装备。</list-item>
  </list>
  <caption>按实际情况调整路线。</caption>
</box>

<AsyncImageGroup query={${JSON.stringify(imageQueries)}} aspectRatio="5:4" layout="bento"/>

<AsyncImageGroup query={["未找到的地图", "未找到的装备"]} layout="bento"/>

图组之后的正文。`;
const observedPrompts = new Map([
  ["检查公式和流程图", observedReplies.markdown_math_code],
  ["检查嵌套表单", observedReplies.writing_and_native_form],
  ["检查交互图表", observedReplies.visual_and_search],
  ["检查文件正文", observedReplies.downloadable_file],
  ...Object.entries(extendedReplies).map(([name, reply]) => [`检查 ${name}`, reply]),
  ...Object.entries(expandedWidgets).map(([name, reply]) => [`检查组件 ${name}`, reply]),
  ["检查图文路线", imageReply],
  [tablesAndMenusPrompt, tablesAndMenusReply],
  [radioDefaultPrompt, radioDefaultReply],
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
      const rich = last === "展示写作模板" || last === "展示其他表单" || last === "检查组件实验室" || last === compatibilityPrompt || observedPrompts.has(last);
      const reply = last === "检查组件实验室" ? await componentPlayground : last === compatibilityPrompt ? await compatibilityReply : await observedPrompts.get(last) ?? (rich ? await richReply : answer);
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
      const chunkSize = slow ? 2 : ["检查组件实验室", compatibilityPrompt, tablesAndMenusPrompt].includes(last) ? 170 : rich ? 17 : 12;
      const timer = setInterval(
        () => {
          const content = contentText.slice(index, index + chunkSize);
          index += chunkSize;
          res.write(
            `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`,
          );
          if (index >= contentText.length) {
            clearInterval(timer);
            const terminal = { choices: [{ delta: {}, finish_reason: "stop" }] };
            if (last === "检查图文路线") {
              terminal.workbench = { blocks: [
                { id: "route", type: "image", queries: ["监控室 游戏地图"], title: "监控室测试图片", imageUrl: "https://example.org/chat-fixtures/route.svg" },
                ...imageQueries.map((title, i) => ({ id: `group-${i}`, type: "image", queries: imageQueries, title, imageUrl: `https://example.org/chat-fixtures/${i}.svg` })),
              ] };
            }
            if (last === compatibilityPrompt) {
              const queries = ["桌面示例", "卡片示例"];
              terminal.workbench = { blocks: [
                { id: "demo-image", ref: "demo-image", type: "image", title: "单图示例", imageUrl: "https://example.org/chat-fixtures/one.svg" },
                { id: "demo-group-1", type: "image", queries, title: "桌面示例", imageUrl: "https://example.org/chat-fixtures/two.svg" },
                { id: "demo-group-2", type: "image", queries, title: "卡片示例", imageUrl: "https://example.org/chat-fixtures/three.svg" },
              ] };
            }
            res.end(`data: ${JSON.stringify(terminal)}\n\ndata: [DONE]\n\n`);
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

async function checkLegacyKeyRotation(page, base) {
  const legacyKey = "浏览器旧密钥-123";
  const newKey = "mock-rotated-key-123!";
  const attachmentId = "fixture-file";
  let legacyLogins = 0;
  let rotations = 0;
  let completions = 0;
  let downloads = 0;
  await page.route("**/auth/login", async (route) => {
    const key = route.request().postDataJSON()?.key;
    if (key === undefined) return route.fallback();
    assert.equal(key, legacyKey);
    assert.equal(route.request().headers().authorization, undefined);
    legacyLogins++;
    return route.fulfill({ json: { ok: true, role: "user", subject_id: "user-a", name: "测试用户", version: "1.16.40" } });
  });
  await page.route("**/api/auth/self/profile", async (route) => {
    rotations++;
    assert.equal(route.request().headers().authorization, undefined);
    assert.deepEqual(route.request().postDataJSON(), { old_key: legacyKey, new_key: newKey });
    return route.fulfill({ json: { success: true, new_key: newKey } });
  });
  await page.route("**/v1/chat/completions", (route) => {
    completions++;
    assert.equal(route.request().headers().authorization, "Bearer " + (completions === 1 ? "mock-user-a" : newKey));
    const events = [
      { choices: [{ delta: { content: "测试附件" } }] },
      { choices: [{ delta: {}, finish_reason: "stop" }], workbench: { blocks: [
        { id: attachmentId, type: "attachment", title: "test.txt", path: "sandbox:/mnt/data/test.txt" },
      ] } },
    ];
    return route.fulfill({ contentType: "text/event-stream", body: events.map((event) => "data: " + JSON.stringify(event) + "\n\n").join("") + "data: [DONE]\n\n" });
  });
  await page.route("**/v1/chat/attachments/" + attachmentId, (route) => {
    downloads++;
    assert.equal(route.request().headers().authorization, "Bearer " + newKey);
    return route.fulfill({ contentType: "text/plain", body: "authenticated attachment" });
  });

  await send(page, "保留这条含附件的历史");
  await waitAnswer(page);
  const attachment = page.getByRole("button", { name: "下载 test.txt", exact: true });
  await attachment.waitFor();

  await seed(page, legacyKey);
  await page.reload();
  await waitReady(page);
  await page.getByRole("alert").filter({ hasText: "请在账号设置中更换密钥" }).waitFor();
  assert.ok(legacyLogins > 0);
  await page.getByRole("textbox", { name: "输入消息", exact: true }).fill("不应发送");
  assert.equal(await page.getByRole("button", { name: "发送消息", exact: true }).isDisabled(), true);
  await attachment.click();
  await page.getByText(/当前密钥.*请在账号设置中更换密钥。/).last().waitFor();
  assert.equal(completions, 1);
  assert.equal(downloads, 0);

  await page.getByRole("link", { name: "打开账号设置", exact: true }).click();
  await page.getByPlaceholder("请输入当前使用的密钥").fill(legacyKey);
  const next = page.getByPlaceholder("至少 6 位新密钥");
  const confirm = page.getByPlaceholder("请再次输入新密钥");
  const saveKey = page.getByRole("button", { name: "确认修改", exact: true });
  await next.fill("仍含中文的密钥");
  await confirm.fill("仍含中文的密钥");
  await saveKey.click();
  await page.getByText(/新密钥只能使用可打印的 ASCII 字符/).waitFor();
  assert.equal(rotations, 0);

  await next.fill(newKey);
  await confirm.fill(newKey);
  await saveKey.click();
  await page.getByText("密钥修改成功，已自动生效", { exact: true }).waitFor();
  assert.equal(rotations, 1);

  await page.goto(base + "/chat/");
  await waitReady(page);
  await page.getByText("保留这条含附件的历史", { exact: true }).waitFor();
  const pendingDownload = page.waitForEvent("download");
  await attachment.click();
  const file = await pendingDownload;
  assert.equal(await readFile(await file.path(), "utf8"), "authenticated attachment");
  assert.equal(downloads, 1);
  await send(page, "更换后请求恢复");
  await waitAnswer(page);
  assert.equal(completions, 2);
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
  const source = page.locator(".chat-widget-unsupported");
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

async function checkRadioDefaultMismatch(page) {
  await send(page, radioDefaultPrompt);
  await waitAnswer(page);
  const form = page.locator(".chat-reply-form");
  const groups = form.getByRole("group");
  assert.equal(await groups.count(), 4);
  assert.equal(await form.getByRole("radio").count(), 18);
  assert.equal(await page.getByRole("checkbox").count(), 0);
  assert.equal(await page.locator(".chat-reply-source, .chat-widget-unsupported").count(), 0);
  for (const name of ["橙色装备为主", "高能镭射步枪", "100M以下"]) {
    assert(await form.getByRole("radio", { name, exact: true }).isChecked());
  }
  assert.equal(await groups.nth(1).locator("input:checked").count(), 0);

  await page.setViewportSize({ width: 390, height: 844 });
  await groups.nth(1).scrollIntoViewIfNeeded();
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: join(artifacts, "radio-default-mismatch-mobile.png") });

  const submit = form.getByRole("button", { name: "生成我的专属刷资源方案" });
  await submit.press("Enter");
  assert.equal(requests.length, 1);
  assert.equal(await form.evaluate((element) => element.checkValidity()), false);
  assert.match(await page.locator(":focus").getAttribute("name"), /-drop$/);

  await form.getByRole("radio", { name: "150%~200%", exact: true }).check();
  assert.equal(await form.evaluate((element) => element.checkValidity()), true);
  const response = page.waitForResponse((item) => item.url().endsWith("/v1/chat/completions") && item.request().method() === "POST");
  await submit.click();
  const followUp = "装备品质：橙色装备为主；爆率：150%~200%；主武器：高能镭射步枪；现金：100M以下。请为我制定刷资源路线。";
  await page.getByText(followUp, { exact: true }).waitFor();
  assert.equal((await response).status(), 200);
  assert.equal(requests.length, 2);
  assert.equal(requests.at(-1).messages.at(-1).content, followUp);
  await waitAnswer(page);
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

async function checkExpandedWidgets(page) {
  async function ask(name) {
    await page.getByRole("button", { name: "新建对话", exact: true }).click();
    await send(page, `检查组件 ${name}`);
    await waitAnswer(page);
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await ask("form");
  const form = page.getByRole("form", { name: "学习安排" });
  await form.getByRole("button", { name: "提交学习安排" }).click();
  assert.equal(await form.getByRole("textbox", { name: "课程名称" }).evaluate((input) => input.validity.valueMissing), true);
  assert.equal(requests.at(-1).messages.at(-1).content, "检查组件 form");
  await form.getByRole("textbox", { name: "课程名称" }).fill("微积分");
  await form.getByLabel("学习日期").fill("2026-11-30");
  await form.getByRole("textbox", { name: "备注" }).fill("练习两题");
  await form.getByRole("radio", { name: "周", exact: true }).check();
  await form.getByText("按周安排", { exact: true }).waitFor();
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await form.scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(artifacts, "expanded-widget-form-mobile.png") });
  const followUp = page.waitForRequest((request) => request.url().endsWith("/v1/chat/completions") && request.method() === "POST");
  await form.getByRole("button", { name: "提交学习安排" }).click();
  assert.equal((await followUp).postDataJSON().messages.at(-1).content, "学习 微积分，备注 练习两题，日期 2026-11-30，周期 周");

  await page.getByRole("button", { name: "重新生成", exact: true }).last().waitFor();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await ask("dashboard");
  const chart = page.getByRole("figure", { name: "金额与成交" });
  assert.equal(await chart.locator("ellipse").count(), 4);
  await chart.getByRole("button", { name: "退货", exact: true }).click();
  assert.equal(await chart.locator("ellipse").count(), 2);
  await page.getByRole("radio", { name: "上周", exact: true }).check();
  assert.equal(await chart.locator("ellipse").count(), 1);
  await chart.getByRole("button", { name: "展开图表", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "金额与成交" });
  await dialog.getByRole("rowheader", { name: "丙" }).waitFor();
  await dialog.getByRole("cell", { name: "3", exact: true }).waitFor();
  await page.screenshot({ path: join(artifacts, "expanded-widget-scatter-desktop.png") });
  await page.keyboard.press("Escape");
  await page.getByText("查看说明", { exact: true }).click();
  await page.getByText("金额以百元计。", { exact: true }).waitFor();

  await ask("media");
  const carousel = page.getByRole("region", { name: "参观要点" });
  await carousel.getByText("展厅", { exact: true }).waitFor();
  await carousel.getByRole("button", { name: "下一项" }).click();
  await carousel.getByText("剧场", { exact: true }).waitFor();
  const map = page.getByRole("region", { name: "参观地点" });
  await page.route((url) => url.host === "www.openstreetmap.org" && url.pathname === "/export/embed.html",
    (route) => route.fulfill({ contentType: "text/html; charset=utf-8", body: "<p>地图预览测试</p>" }));
  assert.equal(await map.locator("iframe").count(), 0);
  await map.getByLabel("地图标记").selectOption("1");
  await map.getByRole("button", { name: "查看地图", exact: true }).click();
  const mapFrame = map.locator("iframe");
  assert.equal(new URL(await mapFrame.getAttribute("src")).searchParams.get("marker"), "39.9,116.4");
  await mapFrame.scrollIntoViewIfNeeded();
  await mapFrame.contentFrame().getByText("地图预览测试").waitFor();
  await page.locator('video[aria-label="短片"][controls]').waitFor();
}

async function checkComponentPlayground(page) {
  await send(page, "检查组件实验室");
  await waitAnswer(page);
  const reply = page.locator(".chat-message.assistant").last();
  await reply.getByText("组件演示结束。", { exact: true }).waitFor();
  assert.equal(await reply.locator("details.chat-reply-source").count(), 0);
  assert.equal(await reply.locator(".chat-widget-unsupported").count(), 1);
  await reply.getByText("未知组件之前", { exact: true }).waitFor();
  await reply.getByText("未知组件之后", { exact: true }).waitFor();
  await reply.getByText("UI Component Lab", { exact: true }).waitFor();
  await reply.getByRole("button", { name: "点击我", exact: true }).click();
  await reply.getByRole("button", { name: "危险按钮示例", exact: true }).click();
  await reply.getByText("点击次数: 2", { exact: true }).waitFor();
  await reply.getByRole("button", { name: "重置", exact: true }).click();
  await reply.getByText("点击次数: 0", { exact: true }).waitFor();
  await reply.getByRole("textbox", { name: "单行输入", exact: true }).fill("新名字");
  await reply.getByText("实时结果: 新名字", { exact: true }).waitFor();
  await reply.getByRole("textbox", { name: "多行输入", exact: true }).fill("四个字符");
  await reply.getByText("字符数: 4", { exact: true }).waitFor();
  await reply.getByRole("combobox", { name: "框架选择" }).selectOption("Vue");
  await reply.getByText("已选择: Vue", { exact: true }).waitFor();
  await reply.getByRole("radio", { name: "选项 B" }).check();
  await reply.getByText("单选: B", { exact: true }).waitFor();
  await reply.getByRole("checkbox", { name: "通知" }).uncheck();
  await reply.getByText("已选: 无", { exact: true }).waitFor();
  await reply.getByRole("checkbox", { name: "邮件" }).check();
  await reply.getByRole("checkbox", { name: "短信" }).check();
  await reply.getByText("已选: 邮件、短信", { exact: true }).waitFor();
  await reply.getByRole("slider", { name: "调整 SLIDER" }).press("ArrowRight");
  await reply.getByText("音量: 55", { exact: true }).waitFor();
  await reply.getByRole("radio", { name: "周", exact: true }).check();
  await reply.getByText("当前视图: 周", { exact: true }).waitFor();
  await reply.getByLabel("日期选择", { exact: true }).fill("2026-12-01");
  await reply.getByText("日期: 2026-12-01", { exact: true }).waitFor();
  await reply.getByRole("spinbutton", { name: "数字输入" }).fill("25");
  await reply.getByText("输入值: 25", { exact: true }).waitFor();
  await reply.getByRole("radio", { name: "关闭", exact: true }).check();
  assert.equal(await reply.locator('.chat-widget-badge[data-color="secondary"]').filter({ hasText: /^关闭$/ }).count(), 1);
  await reply.getByText("基础交互控件", { exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(artifacts, "playground-controls-desktop.png") });

  assert.equal(await reply.locator(".chat-widget-grid-item").count(), 21);
  assert.equal(await reply.locator(".chat-widget-flow-item").count(), 5);
  await reply.getByText("D", { exact: true }).waitFor();
  await reply.getByText("第三行", { exact: true }).waitFor();
  await reply.getByText("标签五", { exact: true }).waitFor();
  await reply.getByText("上方内容", { exact: true }).waitFor();
  await reply.getByText("下方内容", { exact: true }).waitFor();
  assert.equal(await reply.locator(".chat-widget-spacer").count(), 1);
  await reply.getByRole("button", { name: "下一项" }).click();
  await reply.getByText("第二张幻灯片", { exact: true }).waitFor();
  await reply.getByText("当前幻灯片: 2/3", { exact: true }).waitFor();
  await reply.getByText("点击打开弹出层", { exact: true }).click();
  await page.getByText("这里可以放说明。", { exact: true }).waitFor();
  await page.keyboard.press("Escape");
  const pressable = reply.getByRole("button", { name: /点击整个卡片/ });
  await pressable.press("Space");
  await reply.getByText("已点击", { exact: true }).waitFor();
  assert.equal(await pressable.getAttribute("aria-pressed"), "true");
  await reply.getByRole("combobox", { name: "地图标记" }).selectOption("1");
  const location = await reply.getByRole("link", { name: "在 OpenStreetMap 中查找地址" }).getAttribute("href");
  assert.equal(new URL(location).searchParams.get("query"), "San Francisco, California, USA");
  const svg = reply.getByRole("img", { name: "矢量图" });
  assert.equal(await svg.locator("rect, circle, path").count(), 4);
  assert.equal(requests.length, 1);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await waitReady(page);
  await reply.getByText("组件演示结束。", { exact: true }).waitFor();
  await reply.getByText("点击次数: 0", { exact: true }).waitFor();
  await reply.getByRole("checkbox", { name: "通知" }).scrollIntoViewIfNeeded();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: join(artifacts, "playground-controls-mobile.png") });
  await reply.getByRole("img", { name: "矢量图" }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(artifacts, "playground-media-mobile.png") });
}

async function checkWidgetCompatibility(page) {
  await page.route("https://example.org/chat-fixtures/**", (route) => route.fulfill({
    contentType: "image/svg+xml",
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80"><rect width="120" height="80" fill="#dceaf5"/></svg>',
  }));
  await send(page, compatibilityPrompt);
  await waitAnswer(page);
  const reply = page.locator(".chat-message.assistant").last();
  assert.equal(await reply.locator(".chat-widget-unsupported, .chat-reply-source").count(), 0);
  assert.equal(await page.evaluate(() => window.isSecureContext), false);
  assert.equal(await page.evaluate(() => typeof navigator.clipboard), "undefined");

  await reply.getByRole("button", { name: "主要按钮", exact: true }).click();
  await reply.getByText("点击次数：1", { exact: true }).waitFor();
  await reply.getByRole("button", { name: "次要按钮", exact: true }).click();
  await reply.getByText("点击次数：0", { exact: true }).waitFor();
  assert.equal(await reply.getByRole("button", { name: "不可点击" }).isDisabled(), true);
  await reply.getByRole("button", { name: "搜索", exact: true }).waitFor();
  const loading = reply.getByRole("button", { name: "加载中（点击停止）" });
  await reply.getByRole("button", { name: "点击演示加载状态" }).click();
  assert.equal(await loading.getAttribute("aria-busy"), "true");
  await loading.click();
  await reply.getByRole("button", { name: "已关闭" }).click();
  assert.equal(await reply.getByRole("button", { name: "已开启" }).getAttribute("data-widget-color"), "success");

  const first = reply.getByRole("checkbox", { name: "选项一" });
  const second = reply.getByRole("checkbox", { name: "选项二" });
  assert.equal(await first.isChecked(), true);
  await second.check();
  assert.equal(await first.isChecked(), true);
  await second.uncheck();
  await reply.getByRole("checkbox", { name: "UX", exact: true }).check();
  await reply.getByText("选择：UI、UX", { exact: true }).waitFor();
  const dataTab = reply.getByRole("radio", { name: "数据", exact: true });
  await dataTab.press("Space");
  await reply.getByText("当前标签：数据页面", { exact: true }).waitFor();
  await reply.getByRole("combobox", { name: "下拉选择" }).selectOption("高级");
  await reply.getByText("当前：高级", { exact: true }).waitFor();
  await reply.getByRole("slider", { name: "调整 RANGE" }).press("ArrowRight");
  assert.equal(await reply.getByRole("progressbar", { name: "音量" }).getAttribute("value"), "51");
  await reply.getByRole("button", { name: "主要按钮", exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(artifacts, "chat-widgets-desktop.png") });

  const trigger = reply.getByRole("button", { name: "点击打开弹层" });
  await trigger.click();
  const popover = page.getByRole("dialog", { name: "点击打开弹层" });
  await popover.getByRole("button", { name: "弹层内点击 0" }).click();
  await popover.getByRole("button", { name: "弹层内点击 1" }).waitFor();
  await page.screenshot({ path: join(artifacts, "chat-widgets-popover.png") });
  await page.keyboard.press("Escape");
  await popover.waitFor({ state: "hidden" });
  assert.equal(await trigger.evaluate((element) => element === document.activeElement), true);
  await reply.getByRole("button", { name: "下一项" }).click();
  await reply.getByText("第二页", { exact: true }).waitFor();
  await reply.getByText("当前轮播页：2 / 3", { exact: true }).waitFor();
  const submit = reply.getByRole("button", { name: "提交表单" });
  assert.equal(await submit.isDisabled(), true);
  await reply.getByRole("textbox", { name: "姓名", exact: true }).fill("测试用户");
  const email = reply.getByRole("textbox", { name: "邮箱", exact: true });
  await email.fill("invalid");
  await submit.click();
  assert.equal(await reply.getByText("提交成功", { exact: true }).count(), 0);
  await email.fill("test@example.test");
  await submit.click();
  await reply.getByText("提交成功", { exact: true }).waitFor();
  await email.fill("edit@example.test");
  await reply.getByText("提交成功", { exact: true }).waitFor({ state: "hidden" });
  assert.equal(requests.length, 1);

  const table = reply.getByRole("table", { name: "产品状态表" });
  await table.getByRole("columnheader", { name: "数量" }).waitFor();
  assert.equal(await table.getByRole("row").count(), 4);
  await table.getByRole("row", { name: "产品 B 处理中 86" }).waitFor();
  await reply.locator(".katex-display .katex").waitFor();
  await reply.getByText("缺图示例（图片未返回）", { exact: true }).waitFor();
  for (const name of ["单图示例", "桌面示例", "卡片示例"]) {
    const picture = reply.getByRole("img", { name, exact: true });
    await picture.scrollIntoViewIfNeeded();
    assert.equal(await picture.evaluate(async (image) => { await image.decode(); return image.naturalWidth; }), 120);
  }
  const code = reply.getByRole("button", { name: "复制代码", exact: true });
  await code.click();
  assert.equal(await code.innerText(), "已复制");
  assert.equal(await code.evaluate((element) => element === document.activeElement), true);
  const composer = page.getByRole("textbox", { name: "输入消息", exact: true });
  await composer.press("Control+v");
  assert.equal(await composer.inputValue(), 'const greeting = "你好";\nconsole.log(greeting);');
  await composer.fill("");

  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await waitReady(page);
  await table.scrollIntoViewIfNeeded();
  await reply.locator(".katex-display .katex").waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: join(artifacts, "chat-widgets-mobile.png") });
}

async function checkTablesAndMenus(page) {
  page.setDefaultTimeout(8000);
  await send(page, tablesAndMenusPrompt);
  await waitAnswer(page);
  const reply = page.locator(".chat-message.assistant").last();
  const widget = (section) => reply.getByRole("heading", { name: section, exact: true }).locator("xpath=following-sibling::*[1]");
  const fallbackSources = (selector) => reply.locator(selector).allTextContents().then((sources) => sources.map((source) => source.slice(0, 100)));
  assert.deepEqual(await fallbackSources(".chat-reply-source pre"), []);
  assert.deepEqual(await fallbackSources(".chat-widget-unsupported pre"), ['<UnknownWidget option="sample">截图未识别的组件</UnknownWidget>']);

  const staticTable = widget("表格布局").getByRole("table");
  await staticTable.getByRole("columnheader", { name: "数量" }).waitFor();
  assert.equal(await staticTable.getByRole("row").count(), 3);
  await staticTable.getByRole("row", { name: "项目 B 进行中 50" }).waitFor();
  await staticTable.scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(artifacts, "tables-and-menus-layout.png") });

  const containers = widget("可点击布局容器");
  const moduleA = containers.getByRole("button", { name: "模块 A", exact: true });
  const moduleB = containers.getByRole("button", { name: "模块 B", exact: true });
  assert.equal(await moduleA.getAttribute("aria-pressed"), "true");
  await moduleB.press("Enter");
  assert.equal(await moduleB.getAttribute("aria-pressed"), "true");
  assert.equal(await moduleA.getAttribute("aria-pressed"), "false");
  await containers.getByText("当前选中", { exact: true }).waitFor();

  const overlay = widget("浮层布局").getByRole("button", { name: "打开浮层布局" });
  await overlay.press("Space");
  const dialog = page.getByRole("dialog", { name: "打开浮层布局" });
  await dialog.getByText("浮层内容区域", { exact: true }).waitFor();
  await dialog.getByRole("button", { name: "执行操作" }).click();
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "hidden" });
  assert.equal(await overlay.evaluate((element) => element === document.activeElement), true);

  const grid = widget("功能菜单");
  assert.equal(await grid.locator(".chat-widget-grid-item").count(), 3);
  assert.equal(await grid.locator(".chat-widget-grid-item svg").count(), 3);
  await grid.getByText("报表", { exact: true }).waitFor();

  const selectable = widget("可选择列表");
  const design = selectable.getByRole("button", { name: "设计", exact: true });
  const development = selectable.getByRole("button", { name: "开发", exact: true });
  assert.equal(await design.getAttribute("aria-pressed"), "true");
  await development.press("Space");
  await selectable.getByText("已选 2 项：设计、开发", { exact: true }).waitFor();
  await design.click();
  await selectable.getByText("已选 1 项：开发", { exact: true }).waitFor();
  await development.click();
  await selectable.getByText("已选 0 项：暂无", { exact: true }).waitFor();

  const expandable = widget("可展开列表");
  await expandable.getByText("用户列表", { exact: true }).waitFor();
  const orders = expandable.getByRole("button", { name: "订单管理", exact: true });
  assert.equal(await orders.getAttribute("aria-expanded"), "false");
  await orders.press("Enter");
  await expandable.getByText("待处理订单", { exact: true }).waitFor();
  assert.equal(await orders.getAttribute("aria-expanded"), "true");
  await expandable.getByText("用户列表", { exact: true }).waitFor({ state: "hidden" });
  await orders.click();
  await expandable.getByText("待处理订单", { exact: true }).waitFor({ state: "hidden" });

  const cards = widget("卡片式列表");
  await cards.getByText("项目负责人", { exact: true }).waitFor();
  await cards.getByText("离线", { exact: true }).waitFor();
  assert.equal(await cards.locator("svg").count(), 2);

  const selectionTable = widget("带复选框的表格");
  const option = (name) => selectionTable.getByRole("checkbox", { name, exact: true });
  assert.equal(await selectionTable.getByRole("checkbox").count(), 3);
  assert.equal(await option("P001").isChecked(), true);
  await option("P002").check();
  await selectionTable.getByText("2 项已选", { exact: true }).waitFor();
  await selectionTable.getByRole("button", { name: "全选" }).click();
  await selectionTable.getByText("3 项已选", { exact: true }).waitFor();
  await option("P003").uncheck();
  await selectionTable.getByText("2 项已选", { exact: true }).waitFor();

  const editableTable = widget("可编辑表格");
  const field = editableTable.getByRole("textbox", { name: "输入内容" });
  assert.equal(await field.inputValue(), "张三");
  await field.fill("赵六");
  await editableTable.getByRole("cell", { name: "赵六" }).waitFor();

  const actions = widget("带操作按钮的表格").getByRole("table");
  const row1 = actions.getByRole("row", { name: /订单 1/ });
  const row2 = actions.getByRole("row", { name: /订单 2/ });
  await row2.getByRole("button", { name: "完成" }).click();
  await row2.getByRole("cell", { name: "已完成" }).waitFor();
  assert.equal(await row2.getByRole("button", { name: "完成" }).isDisabled(), true);
  await row1.getByRole("cell", { name: "待处理" }).waitFor();
  assert.equal(await row1.getByRole("button", { name: "完成" }).isEnabled(), true);
  await actions.scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(artifacts, "tables-and-menus-tables.png") });

  const dropdown = widget("下拉菜单");
  const chooseAction = dropdown.getByRole("button", { name: "选择操作" });
  await chooseAction.click();
  const dropdownDialog = page.getByRole("dialog", { name: "选择操作" });
  await dropdownDialog.getByRole("button", { name: "归档", exact: true }).waitFor();
  await page.screenshot({ path: join(artifacts, "tables-and-menus-dropdown.png") });
  await dropdownDialog.getByRole("button", { name: "归档", exact: true }).click();
  await dropdown.getByText("当前操作：归档", { exact: true }).waitFor();
  await page.keyboard.press("Escape");
  await dropdownDialog.waitFor({ state: "hidden" });

  const contextMenu = widget("上下文菜单");
  await contextMenu.getByRole("button", { name: "项目文件.txt", exact: true }).click();
  const rename = contextMenu.getByRole("button", { name: "重命名", exact: true });
  await rename.click();
  await rename.waitFor({ state: "hidden" });
  await contextMenu.getByText("执行结果：重命名", { exact: true }).waitFor();

  const menuList = widget("菜单列表");
  const settings = menuList.getByRole("button", { name: "设置", exact: true });
  await settings.click();
  await menuList.getByText("当前菜单：设置", { exact: true }).waitFor();
  assert.equal(await settings.getAttribute("aria-pressed"), "true");

  const nestedMenu = widget("多级菜单");
  await nestedMenu.getByText("当前路径：文件 / 新建", { exact: true }).waitFor();
  await nestedMenu.getByRole("radio", { name: "编辑", exact: true }).check();
  await nestedMenu.getByText("当前路径：编辑 / 未选择", { exact: true }).waitFor();
  await nestedMenu.getByRole("button", { name: "新建", exact: true }).waitFor({ state: "hidden" });
  await nestedMenu.getByRole("button", { name: "撤销", exact: true }).press("Enter");
  await nestedMenu.getByText("当前路径：编辑 / 撤销", { exact: true }).waitFor();

  const fallback = widget("局部降级");
  await fallback.getByText("前面的内容仍可阅读。", { exact: true }).waitFor();
  await fallback.getByText("后面的内容仍可阅读。", { exact: true }).waitFor();
  await fallback.locator(".chat-widget-unsupported summary").click();
  assert.match(await fallback.locator("pre").textContent(), /<UnknownWidget option="sample">/);
  assert.equal(requests.length, 1);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await waitReady(page);
  await nestedMenu.getByText("当前路径：文件 / 新建", { exact: true }).waitFor();
  await nestedMenu.scrollIntoViewIfNeeded();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: join(artifacts, "tables-and-menus-mobile.png") });
}

async function checkImageWidgets(page) {
  await page.route("https://example.org/chat-fixtures/**", (route) => {
    const index = Number(new URL(route.request().url()).pathname.match(/(\d)\.svg$/)?.[1]);
    const color = ["#bad5e1", "#d9ddd0", "#d8cedf"][index] ?? "#b9ced1";
    return route.fulfill({ contentType: "image/svg+xml", body: `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="100"><rect width="160" height="100" fill="${color}"/></svg>` });
  });
  await send(page, "检查图文路线");
  await waitAnswer(page);
  const reply = page.locator(".chat-message.assistant").last();
  await reply.getByText("图组之后的正文。", { exact: true }).waitFor();
  assert.equal(await reply.locator("details.chat-reply-source").count(), 0);
  assert.equal(await reply.locator(".chat-widget-list > li").count(), 2);
  assert.equal(await reply.locator(".chat-widget-caption").innerText(), "按实际情况调整路线。");
  await reply.getByText("路线 B", { exact: true }).waitFor();
  await reply.getByText("图片未返回", { exact: true }).waitFor();
  await reply.getByText("图片组未返回", { exact: true }).waitFor();
  await reply.locator(".chat-widget-image-group img").first().scrollIntoViewIfNeeded();
  await page.waitForFunction(() => [...document.querySelectorAll('.chat-widget-image-group img')].length === 3
    && [...document.querySelectorAll('.chat-widget-image-group img')].every((image) => image.complete && image.naturalWidth > 0));
  const tiles = await reply.locator(".chat-widget-image-group img").evaluateAll((images) => images.map((image) => image.getBoundingClientRect().toJSON()));
  assert(tiles[0].right <= tiles[1].left && tiles[0].right <= tiles[2].left);
  assert(tiles[1].bottom <= tiles[2].top);
  const thumbnail = reply.getByRole("img", { name: "监控室测试图片" });
  assert.equal(Math.round((await thumbnail.boundingBox()).width), 112);
  assert.equal(await reply.locator(".chat-resource-gallery").count(), 0);
  await page.screenshot({ path: join(artifacts, "image-widgets-desktop.png") });
  await reply.locator(".chat-widget-box").first().scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(artifacts, "image-widgets-routes.png") });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await waitReady(page);
  await reply.getByText("图组之后的正文。", { exact: true }).waitFor();
  assert.equal(await reply.locator(".chat-widget-image-group img").count(), 3);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: join(artifacts, "image-widgets-mobile.png") });
}

(async () => {
  await mkdir(artifacts, { recursive: true });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const host = compatibilityMode ? "chat-workbench.test" : "127.0.0.1";
  const base = `http://${host}:${server.address().port}`;
  const browser = await chromium.launch({
    headless: true,
    ...(compatibilityMode ? { args: ["--host-resolver-rules=MAP chat-workbench.test 127.0.0.1", "--no-proxy-server"] } : {}),
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
    if (process.argv.includes("--legacy-key-rotation")) {
      await checkLegacyKeyRotation(page, base);
      assert.deepEqual(errors, []);
      console.log(JSON.stringify({ ok: true, cases: ["legacy-json-login", "message-disabled", "attachment-guard", "reject-new-unicode", "rotate", "recover-history-and-authenticated-requests"] }));
      return;
    }
    if (process.argv.includes("--widget-radio-default")) {
      await checkRadioDefaultMismatch(page);
      assert.deepEqual(errors, []);
      console.log(JSON.stringify({ ok: true, cases: ["radio-default-mismatch", "radio-selection-required", "radio-follow-up-value"], artifacts }));
      return;
    }
    if (compatibilityMode) {
      await checkWidgetCompatibility(page);
      assert.deepEqual(errors, []);
      console.log(JSON.stringify({ ok: true, cases: ["button-states", "indexed-checkboxes", "multi-select", "numeric-tabs", "inline-state", "linked-progress", "popover-focus", "carousel", "local-email-form", "table", "math", "image-binding", "missing-image", "http-clipboard-paste", "mobile-reload"], artifacts }));
      return;
    }
    if (process.argv.includes("--widget-tables-and-menus")) {
      await checkTablesAndMenus(page);
      assert.deepEqual(errors, []);
      console.log(JSON.stringify({ ok: true, cases: ["standalone-table", "conditional-pressable", "standalone-popover", "tuple-grid", "selectable-list", "expandable-object-list", "record-cards", "select-all-table", "editable-table", "row-action-table", "dropdown", "context-menu", "menu-list", "nested-menu", "component-fallback", "mobile-reload"], artifacts }));
      return;
    }
    if (process.argv.includes("--component-playground")) {
      await checkComponentPlayground(page);
      assert.deepEqual(errors, []);
      console.log(JSON.stringify({ ok: true, cases: ["widget-isolation", "counter-reset", "input-feedback", "select-and-radio", "checkbox-list", "slider-and-segments", "date-and-number", "layout-loops", "linked-carousel", "popover", "pressable", "address-map", "svg", "mobile-reload"], artifacts }));
      return;
    }
    if (process.argv.includes("--image-widgets")) {
      await checkImageWidgets(page);
      assert.deepEqual(errors, []);
      console.log(JSON.stringify({ ok: true, cases: ["route-content", "numbered-list-and-caption", "image-placement", "bento-group", "missing-images", "mobile-reload"], artifacts }));
      return;
    }
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
    if (process.argv.includes("--expanded-widgets")) {
      await checkExpandedWidgets(page);
      assert.deepEqual(errors, []);
      console.log(JSON.stringify({ ok: true, cases: ["form-validation", "conditional-state-and-follow-up", "scatter-filter-legend-dialog", "popover", "carousel", "map-inspector", "video-controls"], requests: requests.length, artifacts }));
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
    await page.getByRole("option", { name: "GPT-5.6", exact: true }).click();
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
    await page.getByRole("button", { name: "对话历史", exact: true }).click();
    await page
      .getByRole("button", { name: "重命名 帮我梳理一个想法", exact: true })
      .click();
    await page.getByRole("textbox", { name: "对话名称" }).fill("历史保留测试");
    await page.getByRole("button", { name: "保存", exact: true }).click();
    await page.getByRole("button", { name: "对话历史", exact: true }).click();
    await page.getByRole("textbox", { name: "搜索对话" }).fill("不存在");
    assert.equal(await page.getByText("没有找到相关对话").count(), 1);
    await page.getByRole("textbox", { name: "搜索对话" }).fill("");
    await page.keyboard.press("Escape");
    await page.getByRole("combobox", { name: "选择思考程度" }).click();
    assert.equal(await page.getByRole("option", { name: "Pro", exact: true }).count(), 0);
    await page.keyboard.press("Escape");
    await page.getByRole("combobox", { name: "选择对话模型" }).click();
    await page.getByRole("option", { name: "GPT-6", exact: true }).click();
    for (const [label, model, effort] of [
      ["中", "gpt-6-thinking", "standard"],
      ["高", "gpt-6-thinking", "extended"],
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
    await page
      .getByRole("button", { name: "新建对话", exact: true })
      .first()
      .click();
    await page.getByRole("combobox", { name: "选择对话模型" }).click();
    await page.getByRole("option", { name: "GPT-5.6", exact: true }).click();
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
    await page.getByRole("button", { name: "对话历史", exact: true }).click();
    await page.getByRole("dialog").waitFor();
    await page.screenshot({ path: join(artifacts, "mobile-history.png") });
    await page.keyboard.press("Escape");
    // User A's history must never appear for user B, but must survive a switch back.
    await seed(page, "mock-user-b");
    await page.reload();
    await waitReady(page);
    assert.equal(await page.locator(".chat-message").count(), 0);
    await page.getByRole("button", { name: "对话历史", exact: true }).click();
    assert.equal(
      await page.getByRole("button", { name: /历史保留测试/ }).count(),
      0,
    );
    await page.keyboard.press("Escape");
    await seed(page);
    await page.reload();
    await waitReady(page);
    assert((await page.locator(".chat-message").count()) > 0);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.getByRole("button", { name: "对话历史", exact: true }).click();
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
    await page.keyboard.press("Escape");
    await seed(page, "mock-admin");
    await page.reload();
    await waitReady(page);
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.screenshot({ path: join(artifacts, "admin-tablet.png") });
    assert(
      await page
        .getByRole("button", { name: "打开详细导航", exact: true })
        .isVisible(),
    );
    await page.setViewportSize({ width: 1280, height: 800 });
    const railBox = await page.locator("header.workspace-nav-rail").boundingBox();
    const chatMainBox = await page.locator(".chat-main").boundingBox();
    assert(railBox && chatMainBox && railBox.x + railBox.width <= chatMainBox.x + 2);
    assert(await page.getByRole("link", { name: "号池管理", exact: true }).isVisible());
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.screenshot({ path: join(artifacts, "admin-desktop.png") });
    // Old/unavailable raw-model threads remain readable, but require explicit selection.
    await page.evaluate(async () => {
      const db = await new Promise((resolve, reject) => {
        const req = indexedDB.open("chatgpt2api");
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      const tx = db.transaction("chat_conversations", "readwrite");
      tx.objectStore("chat_conversations").put({
        activeId: "legacy", lastModel: "gpt-5.6-luna-wm",
        threads: [{ id: "legacy", title: "旧模型", updatedAt: Date.now(), model: "gpt-5.6-luna-wm", effort: "", system: "", messages: [{ id: "old", role: "assistant", text: "保留的历史", model: "gpt-5.6-luna-wm", status: "done" }] }],
      }, "admin:user-a");
      await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = reject; });
      db.close();
    });
    await page.reload();
    await waitReady(page);
    await page.getByText("保留的历史", { exact: true }).waitFor();
    await page.getByText(/当前模型设置不可用/).waitFor();
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
