// Backbone descriptions arrive as loose markdown; the UI renders plain text.
export function stripMarkdown(md?: string | null): string {
  if (!md) return "";
  return md
    .replace(/\r\n?/g, "\n")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/^\s*(?:[-*_]\s*){3,}$/gm, "")
    .replace(/(\*\*|__)(.*?)\1/g, "$2")
    .replace(/(\*|_)(?=\S)(.*?)(?<=\S)\1/g, "$2")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*[-*]\s+/gm, "• ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function firstParagraph(text: string): string {
  const i = text.indexOf("\n\n");
  return i > 0 ? text.slice(0, i) : text;
}
