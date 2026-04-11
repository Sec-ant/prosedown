const SAFE_LINK_PROTOCOLS = new Set(["http:", "https:", "mailto:", "tel:", "ftp:"]);

const SCHEME_RE = /^[a-zA-Z][a-zA-Z\d+.-]*:/;

function stripSchemeIgnoredChars(value: string): string {
  return Array.from(value)
    .filter((char) => {
      const code = char.charCodeAt(0);
      return code > 0x20 && code !== 0x7f;
    })
    .join("");
}

/**
 * Return a safe href value, or null when the URL uses an unsafe scheme.
 *
 * Relative links, absolute paths, and fragments do not have a scheme and are
 * allowed. Control characters are removed before scheme detection so inputs
 * like `java\nscript:` cannot bypass the check.
 */
export function normalizeLinkUrl(raw: string | null | undefined): string | null {
  const value = raw?.trim() ?? "";
  if (value === "") return "";

  const compact = stripSchemeIgnoredChars(value);
  const scheme = compact.match(SCHEME_RE)?.[0]?.toLowerCase();

  if (scheme && !SAFE_LINK_PROTOCOLS.has(scheme)) {
    return null;
  }

  return value;
}

export function isSafeAbsoluteLinkUrl(raw: string): boolean {
  const value = normalizeLinkUrl(raw);
  if (!value) return false;

  try {
    const url = new URL(value);
    return SAFE_LINK_PROTOCOLS.has(url.protocol);
  } catch {
    return false;
  }
}
