import { expect, test } from "bun:test";
import { bearerAuthHeader, isHttpAuthKey, validateNewAuthKey } from "../src/lib/auth-key";

test("accepts printable ASCII keys and preserves the Authorization value", () => {
  expect(isHttpAuthKey("local-Key_123!@")).toBe(true);
  expect(bearerAuthHeader("local-Key_123!@")).toBe("Bearer local-Key_123!@");
  expect(() => validateNewAuthKey("  local-Key_123!@  ")).not.toThrow();
});

test("gives a rotation message instead of letting the browser build an invalid header", () => {
  for (const key of ["中文密钥", "old🔑key", "first\tsecond", "key\x7fvalue"]) {
    expect(isHttpAuthKey(key)).toBe(false);
    expect(() => validateNewAuthKey(key)).toThrow("ASCII");
    expect(() => bearerAuthHeader(key)).toThrow("账号设置");
  }
  expect(isHttpAuthKey("key\n")).toBe(false);
  expect(bearerAuthHeader("clé-test")).toBe("Bearer clé-test");
  expect(() => validateNewAuthKey("clé-test")).toThrow("ASCII");
});
