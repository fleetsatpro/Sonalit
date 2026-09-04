import { describe, it, expect } from 'vitest';

import { chunkText, estimateTokens } from './chunker.js';

describe('chunkText', () => {
  it('returns nothing for empty or whitespace-only input', () => {
    expect(chunkText('')).toEqual([]);
    expect(chunkText('   \n\n  ')).toEqual([]);
  });

  it('keeps a short document as a single chunk', () => {
    const chunks = chunkText('Convoys depart at 06:00 from the Mombasa depot.');
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.index).toBe(0);
  });

  it('splits on paragraph boundaries and indexes sequentially', () => {
    const paragraph = `${'word '.repeat(120)}`.trim();
    const chunks = chunkText(`${paragraph}\n\n${paragraph}\n\n${paragraph}`, {
      maxTokens: 200,
      overlapTokens: 0,
    });

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.map((c) => c.index)).toEqual(chunks.map((_, i) => i));
  });

  it('respects the token budget when paragraphs allow it', () => {
    const text = Array.from({ length: 12 }, () => 'sentence body here.'.repeat(8)).join('\n\n');
    const chunks = chunkText(text, { maxTokens: 150, overlapTokens: 0 });

    for (const chunk of chunks) {
      expect(chunk.token_estimate).toBeLessThanOrEqual(150);
    }
  });

  // An oversized chunk is recoverable; a truncated instruction in an SOP is
  // not, so a single unit over budget is kept whole rather than cut.
  it('keeps an over-budget sentence intact rather than truncating it', () => {
    const long = `${'a'.repeat(4000)}.`;
    const chunks = chunkText(long, { maxTokens: 100 });

    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.content).toContain('a'.repeat(4000));
  });

  it('carries overlap so a fact spanning a boundary survives whole', () => {
    const first = 'The corridor buffer is three hundred metres. '.repeat(12);
    const second = 'Escort vehicles travel at the rear. '.repeat(12);
    const chunks = chunkText(`${first}\n\n${second}`, { maxTokens: 120, overlapTokens: 40 });

    expect(chunks.length).toBeGreaterThan(1);
    const laterChunks = chunks.slice(1);
    expect(laterChunks.some((c) => c.content.includes('corridor buffer'))).toBe(true);
  });

  it('never emits an empty chunk', () => {
    const chunks = chunkText('Para one.\n\n\n\n\nPara two.\n\n   \n\nPara three.');
    for (const chunk of chunks) {
      expect(chunk.content.trim().length).toBeGreaterThan(0);
    }
  });
});

describe('estimateTokens', () => {
  it('scales with length', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens('abcd')).toBe(1);
    expect(estimateTokens('a'.repeat(400))).toBe(100);
  });
});
