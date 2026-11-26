export function maskSecretKey(secret: string): string {
  const trimmed = secret.trim();
  if (!trimmed) {
    return "";
  }
  if (trimmed.length <= 8) {
    return "••••••••";
  }
  return `${trimmed.slice(0, 3)}••••••${trimmed.slice(-3)}`;
}
