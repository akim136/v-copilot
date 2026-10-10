// At most max UTF-16 units (a schema's length), never splitting a character.
export function clip(s: string, max: number): string {
  let out = '';
  for (const ch of s) {
    if (out.length + ch.length > max) break;
    out += ch;
  }
  return out;
}

// Whitespace collapsed to single spaces, trimmed, then clipped.
export function oneLine(s: string, max: number): string {
  return clip(s.replace(/\s+/g, ' ').trim(), max);
}

// Model and page text shown as Markdown (report.md, the Telegram card) is flattened to one line and every
// ASCII punctuation character is backslash-escaped, so it can't open a link, an image, HTML, emphasis or a
// table cell, and URLs can't autolink.
export function escapeMarkdown(s: string): string {
  return s.replace(/\s+/g, ' ').trim().replace(/[!-/:-@[-`{-~]/g, '\\$&');
}
