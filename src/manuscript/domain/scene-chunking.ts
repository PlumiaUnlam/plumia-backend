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
  const blocks = collectBlockTexts(content).filter(Boolean);

  const chunks: string[] = [];
  let current: string[] = [];
  let currentChars = 0;
  let currentWords = 0;

  const flushCurrent = (): void => {
    const joined = normalizeWhitespace(current.join('\n\n'));
    if (joined) {
      chunks.push(joined);
    }
    current = [];
    currentChars = 0;
    currentWords = 0;
  };

  for (const block of blocks) {
    const blockText = normalizeWhitespace(block);
    if (!blockText) {
      continue;
    }

    const blockChars = blockText.length;
    const blockWords = countWords(blockText);
    const tooLarge = blockChars > maxChars || blockWords > maxWords;

    if (tooLarge) {
      if (current.length > 0) {
        flushCurrent();
      }

      for (const fragment of splitOversizedBlock(
        blockText,
        maxChars,
        maxWords,
      )) {
        chunks.push(fragment);
      }
      continue;
    }

    const nextChars = currentChars + blockChars + (current.length > 0 ? 2 : 0);
    const nextWords = currentWords + blockWords;
    if (current.length > 0 && (nextChars > maxChars || nextWords > maxWords)) {
      flushCurrent();
    }

    current.push(blockText);
    currentChars += blockChars + (current.length > 1 ? 2 : 0);
    currentWords += blockWords;
  }

  if (current.length > 0) {
    flushCurrent();
  }

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

  const result: string[] = [];
  let current: string[] = [];
  let currentChars = 0;
  let currentWords = 0;

  const flush = (): void => {
    const joined = normalizeWhitespace(current.join(' '));
    if (joined) {
      result.push(joined);
    }
    current = [];
    currentChars = 0;
    currentWords = 0;
  };

  const pushWords = (text: string): void => {
    const words = text.split(/\s+/);
    for (const word of words) {
      const nextChars =
        currentChars + word.length + (current.length > 0 ? 1 : 0);
      const nextWords = currentWords + 1;
      if (
        current.length > 0 &&
        (nextChars > maxChars || nextWords > maxWords)
      ) {
        flush();
      }

      current.push(word);
      currentChars += word.length + (current.length > 1 ? 1 : 0);
      currentWords += 1;
    }
  };

  for (const sentence of sentences.length > 0 ? sentences : [block]) {
    const sentenceChars = sentence.length;
    const sentenceWords = countWords(sentence);
    if (sentenceChars <= maxChars && sentenceWords <= maxWords) {
      const nextChars =
        currentChars + sentenceChars + (current.length > 0 ? 1 : 0);
      const nextWords = currentWords + sentenceWords;
      if (
        current.length > 0 &&
        (nextChars > maxChars || nextWords > maxWords)
      ) {
        flush();
      }

      current.push(sentence);
      currentChars += sentenceChars + (current.length > 1 ? 1 : 0);
      currentWords += sentenceWords;
      continue;
    }

    if (current.length > 0) {
      flush();
    }

    pushWords(sentence);
  }

  if (current.length > 0) {
    flush();
  }

  return result;
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}
