export type CodeTokenKind = "plain" | "comment" | "string" | "keyword" | "number" | "function" | "tag" | "attr" | "operator";
export type CodeToken = { kind: CodeTokenKind; text: string };

const KEYWORDS = new Set([
  "as", "async", "await", "break", "case", "catch", "class", "const", "continue", "def", "default",
  "delete", "do", "elif", "else", "enum", "except", "export", "extends", "false", "finally", "for",
  "from", "function", "if", "import", "in", "interface", "is", "lambda", "let", "match", "new",
  "None", "not", "null", "or", "and", "pass", "private", "public", "raise", "readonly", "return",
  "static", "switch", "this", "throw", "true", "True", "False", "try", "type", "typeof", "undefined",
  "using", "var", "void", "while", "with", "yield", "SELECT", "FROM", "WHERE", "INSERT", "UPDATE",
  "DELETE", "JOIN", "GROUP", "BY", "ORDER", "LIMIT", "AS", "ON", "AND", "OR", "NOT", "CREATE", "TABLE",
]);

const COMMENT_PREFIX = /^(?:\/\/|#(?!\{)|--(?=\s))/;
const TOKEN_REGEX = new RegExp(
  [
    /\/\*[\s\S]*?\*\//.source,
    /<!--[\s\S]*?-->/.source,
    /\/\/[^\n]*/.source,
    /#[^\n]*/.source,
    /"""[\s\S]*?"""|'''[\s\S]*?'''/.source,
    /`(?:\\[\s\S]|[^`\\])*`/.source,
    /"(?:\\[\s\S]|[^"\\\n])*"/.source,
    /'(?:\\[\s\S]|[^'\\\n])*'/.source,
    /<\/?[A-Za-z][\w:-]*/.source,
    /\b0[xXbBoO][\da-fA-F_]+\b|\b\d+(?:_\d+)*(?:\.\d+)?(?:[eE][+-]?\d+)?%?\b/.source,
    /\b[A-Za-z_$][\w$]*(?=\s*\()/.source,
    /\b[A-Za-z_$][\w$-]*(?=\s*=)/.source,
    /\b[A-Za-z_$][\w$]*\b/.source,
    /[{}()[\].,:;?+\-*/%=<>!&|^~]+/.source,
  ].join("|"),
  "g",
);

export function tokenizeCode(source: string, language?: string): CodeToken[] {
  if (!source || source.length > 40000) return [{ kind: "plain", text: source }];
  const lang = (language ?? "").toLowerCase();
  const isMarkup = /^(?:html|xml|svg|jsx|tsx)$/.test(lang);
  const isJson = lang === "json" || lang === "vega-lite" || lang === "vegalite";
  const tokens: CodeToken[] = [];
  let cursor = 0;

  for (const match of source.matchAll(TOKEN_REGEX)) {
    const index = match.index ?? 0;
    const raw = match[0];
    if (index > cursor) tokens.push({ kind: "plain", text: source.slice(cursor, index) });

    let kind: CodeTokenKind = "plain";
    if (raw.startsWith("/*") || raw.startsWith("<!--") || COMMENT_PREFIX.test(raw)) {
      kind = isMarkup && raw.startsWith("#") ? "plain" : "comment";
    } else if (raw.startsWith('"') || raw.startsWith("'") || raw.startsWith("`")) {
      const after = source.slice(index + raw.length);
      kind = isJson && /^\s*:/.test(after) ? "attr" : "string";
    } else if (raw.startsWith("<") && isMarkup) {
      kind = "tag";
    } else if (/^\d/.test(raw)) {
      kind = "number";
    } else if (isMarkup && /^[A-Za-z_$]/.test(raw) && /^\s*=/.test(source.slice(index + raw.length))) {
      kind = "attr";
    } else if (KEYWORDS.has(raw)) {
      kind = "keyword";
    } else if (/^[A-Za-z_$]/.test(raw)) {
      const after = source.slice(index + raw.length);
      if (/^\s*\(/.test(after)) kind = "function";
      else if (/^[A-Z][\w$]*$/.test(raw)) kind = "tag";
    } else {
      kind = "operator";
    }

    const previous = tokens.at(-1);
    if (previous && previous.kind === kind) previous.text += raw;
    else tokens.push({ kind, text: raw });
    cursor = index + raw.length;
  }

  if (cursor < source.length) tokens.push({ kind: "plain", text: source.slice(cursor) });
  return tokens;
}
