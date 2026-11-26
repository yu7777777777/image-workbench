import { expect, test } from "bun:test";
import {
  CHAT_FAMILIES,
  CHAT_LEVELS,
  chatChoice,
  chatFamilies,
  chatLevelAvailable,
  chatModelLabel,
  chatSelection,
} from "../src/lib/chat-models";

test("three web families with exact upstream preset mappings", () => {
  expect(CHAT_FAMILIES.map((f) => f.label)).toEqual(["GPT-6", "GPT-5.6", "GPT-5.5"]);
  for (const family of CHAT_FAMILIES) for (const level of CHAT_LEVELS) {
    const choice = chatChoice(family.id, level.id)!;
    expect(chatSelection(choice.model, choice.effort)).toEqual({ family: family.id, level: level.id });
  }
  expect(chatChoice("gpt-5-6", "extended")).toEqual({ model: "gpt-5-6-thinking", effort: "extended" });
  expect(chatChoice("gpt-6", "pro")).toEqual({ model: "gpt-6-pro", effort: "" });
});

test("legacy, bare, and unknown models preserve exact display names without silently relabelling", () => {
  expect(chatSelection("auto", "")).toEqual({ family: "auto", level: "instant" });
  expect(chatSelection("gpt-5-6", "")).toEqual({ family: "gpt-5-6", level: "instant" });
  expect(chatSelection("gpt-5.6-luna-wm", "")).toEqual({ family: "gpt-5.6-luna-wm", level: "instant" });
  expect(chatSelection("gpt-5.6-luna-wm", "extended")).toBeNull();
  expect(chatSelection("", "")).toBeNull();

  expect(chatModelLabel("gpt-5-6")).toBe("GPT-5.6");
  expect(chatModelLabel("gpt-5.6-luna-wm")).toBe("gpt-5.6-luna-wm");
  expect(chatModelLabel("auto")).toBe("自动选择");
  expect(chatFamilies(["gpt-6", "gpt-5-6", "gpt-5.6-luna-wm"])).toEqual([
    { id: "gpt-6", label: "GPT-6" },
    { id: "gpt-5-6", label: "GPT-5.6" },
    { id: "gpt-5.6-luna-wm", label: "gpt-5.6-luna-wm" },
  ]);

  expect(chatChoice("unknown", "standard")).toBeNull();
  expect(chatChoice("gpt-6", "unknown")).toBeNull();
  expect(chatChoice("gpt-5.6-luna-wm", "instant", ["gpt-5.6-luna-wm"])).toEqual({ model: "gpt-5.6-luna-wm", effort: "" });
  expect(chatChoice("gpt-5.6-luna-wm", "extended", ["gpt-5.6-luna-wm"])).toBeNull();
});

test("bare upstream family models can use thinking effort presets", () => {
  expect(chatSelection("gpt-6", "")).toEqual({ family: "gpt-6", level: "instant" });
  expect(chatChoice("gpt-6", "extended", ["gpt-6"])).toEqual({ model: "gpt-6", effort: "extended" });
  expect(chatLevelAvailable("gpt-6", "instant", ["gpt-6"])).toBe(true);
  expect(chatLevelAvailable("gpt-6", "extended", ["gpt-6"])).toBe(true);
  expect(chatLevelAvailable("gpt-6", "max", ["gpt-6"])).toBe(false);
  expect(chatLevelAvailable("gpt-6", "pro", ["gpt-6"])).toBe(false);
});
