/**
 * Split text into overlapping chunks for embedding.
 *
 * Splits on paragraph boundaries first (blank lines), then packs paragraphs
 * into chunks of at most `size` characters with `overlap` characters of
 * carried context between consecutive chunks. Very long paragraphs are
 * hard-split on whitespace so a single paragraph can never exceed `size`.
 */
export function chunkText(text: string, size: number, overlap: number): string[] {
  const paragraphs = text
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter((p) => p.length > 0);

  const pieces: string[] = [];
  for (const paragraph of paragraphs) {
    if (paragraph.length <= size) {
      pieces.push(paragraph);
      continue;
    }
    // Hard-split an oversized paragraph on word boundaries.
    let start = 0;
    while (start < paragraph.length) {
      let end = Math.min(start + size, paragraph.length);
      if (end < paragraph.length) {
        const lastSpace = paragraph.lastIndexOf(" ", end);
        if (lastSpace > start) end = lastSpace;
      }
      pieces.push(paragraph.slice(start, end).trim());
      // Carry `overlap` characters into the next window; `start + 1`
      // guarantees progress even when overlap >= window size.
      start = Math.max(end - overlap, start + 1);
    }
  }

  // Pack pieces into chunks with overlap between adjacent chunks.
  const chunks: string[] = [];
  let current = "";
  for (const piece of pieces) {
    if (!current) {
      current = piece;
      continue;
    }
    const joined = `${current} ${piece}`;
    if (joined.length <= size) {
      current = joined;
      continue;
    }
    chunks.push(current);
    current = overlap > 0 ? `${current.slice(-overlap)} ${piece}` : piece;
  }
  if (current) chunks.push(current);
  return chunks;
}
