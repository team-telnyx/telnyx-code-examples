/**
 * Cosine similarity between two equal-length vectors. Returns a value in
 * [-1, 1]; 1 means identical direction. Telnyx Edge SQL has no vector type,
 * so at sample scale the corpus agent scans its chunk rows and ranks them
 * here — for large corpora use the managed
 * `TELNYX.ai.embeddings.similaritySearch` API instead.
 */
export function cosine(a: readonly number[], b: readonly number[]): number {
  if (a.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  return denominator === 0 ? 0 : dot / denominator;
}
