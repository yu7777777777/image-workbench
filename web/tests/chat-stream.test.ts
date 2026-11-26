import { describe, expect, test } from "bun:test";
import { isChatModel, readChatResponse } from "../src/lib/chat-stream";
import { mergeChatResources, type ChatResource } from "../src/lib/chat-resources";

function streamResponse(text: string, slice = 1) {
  const bytes = new TextEncoder().encode(text);
  return new Response(
    new ReadableStream({
      start(controller) {
        for (let index = 0; index < bytes.length; index += slice)
          controller.enqueue(bytes.slice(index, index + slice));
        controller.close();
      },
    }),
    { headers: { "content-type": "text/event-stream" } },
  );
}
describe("chat response stream", () => {
  test("does not expose upstream auth JSON", async () => {
    await expect(readChatResponse(Response.json({error: {message: 'chat_requirements_prepare status=401 token_expired'}}, {status: 502}), () => {})).rejects.toThrow("模型账号认证已失效");
  });
  test("handles UTF-8, CRLF, comments and frames split across network chunks", async () => {
    let result = "";
    await readChatResponse(
      streamResponse(
        ': ping\r\n\r\ndata: {"choices":[{"delta":{"content":"你好🌼"}}]}\r\n\r\ndata: {"choices":[{"delta":{"content":"世界"},"finish_reason":"stop"}]}\r\n\r\ndata: [DONE]\r\n\r\n',
      ),
      (text) => {
        result += text;
      },
    );
    expect(result).toBe("你好🌼世界");
  });
  test("reports interrupted streams without discarding the partial answer", async () => {
    let result = "";
    await expect(
      readChatResponse(
        streamResponse(
          'data: {"choices":[{"delta":{"content":"部分内容"}}]}\n\n',
        ),
        (text) => {
          result += text;
        },
      ),
    ).rejects.toThrow("连接提前断开");
    expect(result).toBe("部分内容");
  });
  test("delivers rich blocks without exposing unknown fields or unsafe image addresses", async () => {
    const first = { id: "image-1", type: "image", imageUrl: "https://cdn.example.com/photo.png", title: "图像" };
    const second = { id: "image-1", type: "image", description: "后到的说明", imageUrl: first.imageUrl, upstreamKey: "ignored" };
    const output = { id: "result-1", type: "python", text: "你好\n2", status: "success" };
    const invalid = { id: "bad", type: "image", imageUrl: "https://127.0.0.1/image.png" };
    const frame = (data: unknown) => `data: ${JSON.stringify(data)}\r\n\r\n`;
    let text = "";
    let resources: ChatResource[] = [];
    await readChatResponse(
      streamResponse(frame({ choices: [{ delta: { content: "执行中" } }] })
        + frame({ workbench: { blocks: [first, invalid] } })
        + frame({ workbench: { blocks: [second, output] }, choices: [{ finish_reason: "stop" }] })),
      (delta) => { text += delta; },
      (incoming) => { resources = mergeChatResources(resources, incoming); },
    );
    expect(text).toBe("执行中");
    expect(resources).toEqual([{ ...first, description: second.description }, output]);
  });
  test("allows a successful resource-only response for opt-in callers", async () => {
    const resource = { id: "attachment-1", type: "attachment", path: "sandbox:/mnt/data/a b.txt", title: "a b.txt" };
    const responses: ChatResource[][] = [];
    const data = { workbench: { blocks: [resource] } };
    await readChatResponse(
      streamResponse(`data: ${JSON.stringify(data)}\n\ndata: [DONE]\n\n`),
      () => { throw new Error("没有文本"); },
      (resources) => responses.push(resources),
    );
    await readChatResponse(Response.json(data), () => {}, (resources) => responses.push(resources));
    expect(responses).toEqual([[{ ...resource, path: "sandbox:/mnt/data/a%20b.txt" }], [{ ...resource, path: "sandbox:/mnt/data/a%20b.txt" }]]);
    await expect(readChatResponse(Response.json(data), () => {})).rejects.toThrow("没有返回内容");
  });
  test("reports HTTP and in-stream errors", async () => {
    await expect(
      readChatResponse(
        new Response(JSON.stringify({ detail: { error: "模型不可用" } }), {
          status: 403,
        }),
        () => {},
      ),
    ).rejects.toThrow("模型不可用");
    await expect(
      readChatResponse(
        streamResponse('data: {"error":{"message":"限额不足"}}\n\n'),
        () => {},
      ),
    ).rejects.toThrow("限额不足");
  });
  test("accepts JSON fallback, rejects empty completions", async () => {
    let result = "";
    await readChatResponse(
      Response.json({ choices: [{ message: { content: "完整回答" } }] }),
      (text) => {
        result = text;
      },
    );
    expect(result).toBe("完整回答");
    await expect(
      readChatResponse(streamResponse("data: [DONE]\n\n"), () => {}),
    ).rejects.toThrow("没有返回内容");
  });
  test("excludes known non-chat models", () => {
    for (const id of [
      "gpt-image-2",
      "plus-gpt-image-2",
      "dall-e-3",
      "text-embedding-3-small",
      "whisper-1",
    ])
      expect(isChatModel(id)).toBe(false);
    for (const id of ["auto", "gpt-5", "gpt-4o-search-preview"])
      expect(isChatModel(id)).toBe(true);
  });
});
