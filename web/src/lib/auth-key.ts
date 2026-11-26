export const LEGACY_AUTH_KEY_MESSAGE = "当前密钥含有无法用于浏览器请求的字符，请在账号设置中更换密钥。";
const NEW_AUTH_KEY_MESSAGE = "新密钥只能使用可打印的 ASCII 字符，例如英文字母、数字和英文标点";

export function isHttpAuthKey(key: string): boolean {
  return key.length > 0 && !/[^\x20-\x7e\xa0-\xff]/.test(key);
}

export function bearerAuthHeader(key: string): string {
  if (!isHttpAuthKey(key)) throw new Error(LEGACY_AUTH_KEY_MESSAGE);
  return "Bearer " + key;
}

export function validateNewAuthKey(rawKey: string): void {
  const key = rawKey.trim();
  if (key && /[^\x20-\x7e]/.test(key)) throw new Error(NEW_AUTH_KEY_MESSAGE);
}
