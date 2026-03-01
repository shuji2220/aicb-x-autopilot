/**
 * x_text.ts — Tweet text utilities: normalize, weight calculation, auto-shorten.
 *
 * X (Twitter) weighted character rules:
 *   - CJK / Hiragana / Katakana / Fullwidth = 2 weight each
 *   - ASCII and other characters = 1 weight each
 *   - Any URL (http:// or https://) = 23 weight (t.co shortening)
 *   - Max tweet weight = 280
 */

const MAX_WEIGHT = 280;
const URL_WEIGHT = 23;
const URL_RE = /https?:\/\/\S+/g;

// Unicode ranges treated as weight-2
function isCJK(cp: number): boolean {
  return (
    (cp >= 0x3000 && cp <= 0x9fff) ||   // CJK, Hiragana, Katakana, symbols
    (cp >= 0xf900 && cp <= 0xfaff) ||   // CJK Compatibility
    (cp >= 0xff01 && cp <= 0xff60) ||   // Fullwidth forms
    (cp >= 0x20000 && cp <= 0x2fa1f)    // CJK Extension
  );
}

/**
 * Normalize tweet text:
 *  - Trim leading/trailing whitespace
 *  - Collapse 3+ consecutive newlines → 2
 *  - Collapse runs of spaces (not newlines) → single space
 *  - Remove trailing spaces on each line
 */
export function normalizeTweet(text: string): string {
  return text
    .trim()
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[^\S\n]+/g, " ")
    .replace(/ +$/gm, "");
}

/**
 * Calculate X weighted character count.
 * CJK = 2, others = 1, URLs = 23 fixed.
 */
export function tweetWeight(text: string): number {
  const withoutUrls = text.replace(URL_RE, "");
  const urlCount = (text.match(URL_RE) || []).length;

  let w = urlCount * URL_WEIGHT;
  for (const ch of withoutUrls) {
    const cp = ch.codePointAt(0) ?? 0;
    w += isCJK(cp) ? 2 : 1;
  }
  return w;
}

export type ShortenResult = {
  text: string;
  shortened: boolean;
  originalWeight: number;
  finalWeight: number;
};

/**
 * Auto-shorten tweet text to fit within maxWeight.
 *
 * Strategy:
 *  1. Normalize first.
 *  2. Separate body lines from footer lines (「詳細はこちらから」+ URL).
 *  3. If already within limit, return as-is.
 *  4. Otherwise, remove body lines from the end (keeping complete sentences)
 *     until it fits. Never cut a sentence in the middle.
 */
export function shortenTweet(
  text: string,
  maxWeight: number = MAX_WEIGHT,
): ShortenResult {
  const normalized = normalizeTweet(text);
  const originalWeight = tweetWeight(normalized);

  if (originalWeight <= maxWeight) {
    return { text: normalized, shortened: false, originalWeight, finalWeight: originalWeight };
  }

  // Split body from footer (「AI Contents Bank開発中」+ URL line)
  const lines = normalized.split("\n");
  const footerLines: string[] = [];
  let bodyLines: string[] = [];

  // Find URL line and optional 「AI Contents Bank開発中」 line from the end
  for (let i = lines.length - 1; i >= 0; i--) {
    const trimmed = lines[i].trim();
    if (/^https?:\/\//.test(trimmed) || trimmed === "AI Contents Bank開発中") {
      footerLines.unshift(trimmed);
    } else if (trimmed === "") {
      // skip trailing empty lines between body and footer
      if (footerLines.length > 0) continue;
    } else {
      bodyLines = lines.slice(0, i + 1);
      break;
    }
  }

  // If no footer found, treat entire text as body
  if (footerLines.length === 0) {
    bodyLines = lines;
  }

  const footer = footerLines.length > 0 ? "\n" + footerLines.join("\n") : "";

  // Remove body lines from the end until it fits
  while (bodyLines.length > 1) {
    const candidate = bodyLines.join("\n") + footer;
    if (tweetWeight(candidate) <= maxWeight) break;
    // Remove last non-empty body line
    bodyLines.pop();
    // Also remove trailing empty lines
    while (bodyLines.length > 0 && bodyLines[bodyLines.length - 1].trim() === "") {
      bodyLines.pop();
    }
  }

  const finalText = bodyLines.join("\n") + footer;
  const finalWeight = tweetWeight(finalText);

  return {
    text: finalText,
    shortened: true,
    originalWeight,
    finalWeight,
  };
}
