import { createHash } from 'node:crypto';

interface ProseMirrorNode {
  type?: string;
  text?: string;
  content?: ProseMirrorNode[];
}

export interface SceneChunkPlan {
  chunkIndex: number;
  content: string;
  contentHash: string;
  tokenCount: number;
}

interface ChunkBuilder {
  chunks: string[];
  current: string[];
  currentChars: number;
  currentWords: number;
}

const DEFAULT_MAX_CHUNK_CHARS = 2600;
const DEFAULT_MAX_CHUNK_WORDS = 420;
const BLOCK_NODE_TYPES = new Set([
  'paragraph',
  'heading',
  'blockquote',
  'codeBlock',
  'listItem',
  'tableCell',
  'tableHeader',
]);

export function planSceneChunks(
  content: unknown,
  options?: {
    maxChars?: number;
    maxWords?: number;
  },
): SceneChunkPlan[] {
  const maxChars = Math.max(400, options?.maxChars ?? DEFAULT_MAX_CHUNK_CHARS);
  const maxWords = Math.max(80, options?.maxWords ?? DEFAULT_MAX_CHUNK_WORDS);
  const chunks = chunkBlocks(collectBlockTexts(content), maxChars, maxWords);

  return chunks.map((chunk, index) => ({
    chunkIndex: index,
    content: chunk,
    contentHash: createStringHash(chunk),
    tokenCount: countWords(chunk),
  }));
}

export function createStringHash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function countWords(value: string): number {
  const text = normalizeWhitespace(value);
  return text ? text.split(/\s+/).length : 0;
}

function chunkBlocks(
  blocks: string[],
  maxChars: number,
  maxWords: number,
): string[] {
  const builder: ChunkBuilder = {
    chunks: [],
    current: [],
    currentChars: 0,
    currentWords: 0,
  };

  for (const block of blocks) {
    appendBlock(builder, block, maxChars, maxWords);
  }
  flush(builder, '\n\n');
  return builder.chunks;
}

function appendBlock(
  builder: ChunkBuilder,
  block: string,
  maxChars: number,
  maxWords: number,
): void {
  const text = normalizeWhitespace(block);
  if (!text) {
    return;
  }

  const words = countWords(text);
  if (text.length > maxChars || words > maxWords) {
    flush(builder, '\n\n');
    builder.chunks.push(...splitOversizedBlock(text, maxChars, maxWords));
    return;
  }

  const separatorChars = builder.current.length > 0 ? 2 : 0;
  const nextChars = builder.currentChars + text.length + separatorChars;
  const nextWords = builder.currentWords + words;
  if (
    builder.current.length > 0 &&
    (nextChars > maxChars || nextWords > maxWords)
  ) {
    flush(builder, '\n\n');
  }

  const nextSeparatorChars = builder.current.length > 0 ? 2 : 0;
  builder.current.push(text);
  builder.currentChars += text.length + nextSeparatorChars;
  builder.currentWords += words;
}

function flush(builder: ChunkBuilder, separator: string): void {
  if (builder.current.length > 0) {
    const joined = normalizeWhitespace(builder.current.join(separator));
    if (joined) {
      builder.chunks.push(joined);
    }
  }
  builder.current = [];
  builder.currentChars = 0;
  builder.currentWords = 0;
}

function collectBlockTexts(node: unknown): string[] {
  if (!node) {
    return [];
  }

  if (Array.isArray(node)) {
    return node.flatMap((child) => collectBlockTexts(child));
  }

  if (typeof node !== 'object') {
    return [];
  }

  const currentNode = node as ProseMirrorNode;

  if (typeof currentNode.text === 'string') {
    return [normalizeWhitespace(currentNode.text)];
  }

  if (!Array.isArray(currentNode.content) || currentNode.content.length === 0) {
    return [];
  }

  if (BLOCK_NODE_TYPES.has(currentNode.type ?? '')) {
    const text = collectInlineText(currentNode.content);
    return text ? [normalizeWhitespace(text)] : [];
  }

  return currentNode.content.flatMap((child) => collectBlockTexts(child));
}

function collectInlineText(nodes: ProseMirrorNode[]): string {
  return nodes
    .map((node) => {
      if (typeof node.text === 'string') {
        return node.text;
      }

      if (!Array.isArray(node.content) || node.content.length === 0) {
        return '';
      }

      return collectInlineText(node.content);
    })
    .join(' ');
}

function splitOversizedBlock(
  block: string,
  maxChars: number,
  maxWords: number,
): string[] {
  const sentences = block
    .split(/(?<=[.!?])\s+/u)
    .map((sentence) => normalizeWhitespace(sentence))
    .filter(Boolean);

  const builder: ChunkBuilder = {
    chunks: [],
    current: [],
    currentChars: 0,
    currentWords: 0,
  };

  for (const sentence of sentences.length > 0 ? sentences : [block]) {
    appendSentence(builder, sentence, maxChars, maxWords);
  }
  flush(builder, ' ');
  return builder.chunks;
}

function appendSentence(
  builder: ChunkBuilder,
  sentence: string,
  maxChars: number,
  maxWords: number,
): void {
  const sentenceWords = countWords(sentence);
  if (sentence.length <= maxChars && sentenceWords <= maxWords) {
    appendTextChunk(builder, sentence, sentenceWords, maxChars, maxWords);
    return;
  }

  flush(builder, ' ');
  appendWords(builder, sentence, maxChars, maxWords);
}

function appendTextChunk(
  builder: ChunkBuilder,
  text: string,
  words: number,
  maxChars: number,
  maxWords: number,
): void {
  const separatorChars = builder.current.length > 0 ? 1 : 0;
  const nextChars = builder.currentChars + text.length + separatorChars;
  const nextWords = builder.currentWords + words;
  if (
    builder.current.length > 0 &&
    (nextChars > maxChars || nextWords > maxWords)
  ) {
    flush(builder, ' ');
  }

  const nextSeparatorChars = builder.current.length > 0 ? 1 : 0;
  builder.current.push(text);
  builder.currentChars += text.length + nextSeparatorChars;
  builder.currentWords += words;
}

function appendWords(
  builder: ChunkBuilder,
  text: string,
  maxChars: number,
  maxWords: number,
): void {
  for (const word of text.split(/\s+/)) {
    appendTextChunk(builder, word, 1, maxChars, maxWords);
  }
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}
