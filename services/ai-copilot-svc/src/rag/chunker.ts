// Document chunking for the knowledge fabric (spec §17).
//
// Chunking decides what the model can actually see, so the failure modes
// matter more than the algorithm: a chunk split mid-sentence loses the
// clause that made it meaningful, and a chunk larger than the retrieval
// budget crowds out competing evidence.
//
// The strategy is paragraph-first with sentence fallback, plus an overlap
// so a fact spanning a boundary survives in at least one chunk whole.
// Operational SOPs are strongly paragraph-structured, which makes this a
// better fit here than fixed-width splitting.

/** ~4 chars/token. Crude, and used only for budgeting — never for billing. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export interface Chunk {
  index: number;
  content: string;
  token_estimate: number;
}

export interface ChunkOptions {
  /** Target size. Chunks may exceed it only when a single sentence does. */
  maxTokens?: number;
  /** Tokens of trailing context repeated into the next chunk. */
  overlapTokens?: number;
}

/**
 * Splits into sentences on terminal punctuation followed by whitespace.
 *
 * Deliberately simple, and it will mis-split on abbreviations ("approx. 4
 * km"). That is an acceptable cost here: the consequence is a slightly
 * early boundary, which the overlap then repairs, whereas a real sentence
 * tokeniser would add a dependency and a language assumption to a
 * multilingual corpus (§4.4).
 */
function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function splitParagraphs(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((p) => p.replace(/[ \t]+/g, ' ').trim())
    .filter((p) => p.length > 0);
}

/** Last `tokens` worth of text, snapped to a sentence boundary where possible. */
function tailOverlap(text: string, tokens: number): string {
  if (tokens <= 0) return '';
  const chars = tokens * 4;
  if (text.length <= chars) return text;
  const tail = text.slice(-chars);
  const boundary = tail.search(/(?<=[.!?])\s+/);
  return boundary === -1 ? tail : tail.slice(boundary).trim();
}

export function chunkText(text: string, options: ChunkOptions = {}): Chunk[] {
  const maxTokens = options.maxTokens ?? 400;
  const overlapTokens = options.overlapTokens ?? 40;

  const normalised = text.replace(/\r\n/g, '\n').trim();
  if (normalised.length === 0) return [];

  // Paragraphs are the preferred unit; a paragraph too large for one chunk
  // is broken down into sentences rather than cut at a character offset.
  const units: string[] = [];
  for (const paragraph of splitParagraphs(normalised)) {
    if (estimateTokens(paragraph) <= maxTokens) {
      units.push(paragraph);
      continue;
    }
    for (const sentence of splitSentences(paragraph)) {
      units.push(sentence);
    }
  }

  const chunks: Chunk[] = [];
  let current = '';

  const flush = (): void => {
    const content = current.trim();
    if (content.length === 0) return;
    chunks.push({
      index: chunks.length,
      content,
      token_estimate: estimateTokens(content),
    });
  };

  for (const unit of units) {
    const candidate = current.length > 0 ? `${current}\n\n${unit}` : unit;

    if (estimateTokens(candidate) <= maxTokens) {
      current = candidate;
      continue;
    }

    flush();
    const overlap = tailOverlap(current, overlapTokens);
    // A single unit larger than the budget is kept whole rather than cut
    // mid-sentence: an oversized chunk is recoverable, a truncated
    // instruction in an SOP is not.
    current =
      overlap.length > 0 && estimateTokens(`${overlap}\n\n${unit}`) <= maxTokens
        ? `${overlap}\n\n${unit}`
        : unit;
  }
  flush();

  return chunks;
}
