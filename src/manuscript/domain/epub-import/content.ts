import type { XmlElement, XmlNode } from './types';
import {
  normalizedLabel,
  textContent,
  normalizeWhitespace,
  attribute,
  elements,
  blockIds,
} from './archive';
import {
  isBoilerplateText,
  isYear,
  isRomanNumeral,
  isExcludedMatter,
  isExcludedMatterLabel,
  meaningfulNavigationTitle,
} from './structure';

function fallbackTitle(path: string): string {
  const basename = path.split('/').pop() ?? 'Capítulo';
  const title = basename.replace(/\.[^.]+$/u, '').replace(/[-_]+/gu, ' ');
  try {
    return decodeURIComponent(title);
  } catch {
    return title;
  }
}

/** Selects a title only from retained narrative blocks. */
export function chapterTitleFromDocument(
  blocks: XmlElement[],
  bookTitle: string,
): string | null {
  const headings = blocks.filter(
    (block) => block.name === 'h1' || block.name === 'h2',
  );
  const matchingBookTitle = headings.find(
    (heading) =>
      normalizedLabel(textContent(heading)) === normalizedLabel(bookTitle),
  );
  if (matchingBookTitle) {
    return normalizeWhitespace(textContent(matchingBookTitle)).trim();
  }

  for (const heading of headings) {
    const title = normalizeWhitespace(textContent(heading)).trim();
    if (title && !isBoilerplateText(title) && !isYear(title)) {
      return title;
    }
  }

  for (const block of blocks) {
    const title = normalizeWhitespace(textContent(block)).trim();
    if (
      title &&
      title.length <= 100 &&
      !isBoilerplateText(title) &&
      !isYear(title) &&
      !isRomanNumeral(title) &&
      !/[.!?]$/u.test(title)
    ) {
      return title;
    }
  }
  return null;
}

const CONTENT_BLOCK_NAMES = new Set([
  'blockquote',
  'figure',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'hr',
  'img',
  'ol',
  'p',
  'pre',
  'table',
  'ul',
]);

const CONTENT_CONTAINERS = new Set([
  'article',
  'body',
  'center',
  'div',
  'main',
  'section',
]);

/** Flattens narrative containers while preserving IDs at their first block. */
export function contentBlocks(root: XmlElement): XmlElement[] {
  const result: XmlElement[] = [];
  const visit = (node: XmlNode): void => {
    if (node.kind !== 'element') {
      return;
    }
    if (isExcludedMatter(node)) {
      return;
    }
    if (CONTENT_BLOCK_NAMES.has(node.name)) {
      result.push(node);
      return;
    }
    if (CONTENT_CONTAINERS.has(node.name)) {
      const firstIndex = result.length;
      for (const child of node.children) {
        visit(child);
      }
      const firstBlock = result[firstIndex];
      const id = attribute(node, 'id');
      if (firstBlock && id) {
        firstBlock.boundaryIds = [...(firstBlock.boundaryIds ?? []), id];
      }
      return;
    }
    result.push(node);
  };

  const retained = pruneExcludedMatter(root);
  if (retained) {
    visit(retained);
  }
  return filterEditorialHeadings(carryEmptyAnchors(result));
}

/** Moves empty anchor destinations onto the next visible block without creating filler scenes. */
function carryEmptyAnchors(blocks: XmlElement[]): XmlElement[] {
  const retained: XmlElement[] = [];
  let pendingIds: string[] = [];
  for (const block of blocks) {
    if (
      !normalizeWhitespace(textContent(block)).trim() &&
      !elements(block, 'img').length &&
      block.name !== 'hr'
    ) {
      pendingIds.push(...blockIds(block));
      continue;
    }
    retained.push({
      ...block,
      boundaryIds: [...pendingIds, ...(block.boundaryIds ?? [])],
    });
    pendingIds = [];
  }
  if (pendingIds.length) {
    retained.push({
      kind: 'element',
      name: 'span',
      attributes: {},
      children: [],
      boundaryIds: pendingIds,
    });
  }
  return retained;
}

/** Removes semantic editorial descendants even inside lists, quotes and inline spans. */
function pruneExcludedMatter(node: XmlNode): XmlNode | null {
  if (node.kind === 'text') {
    return node;
  }
  if (isExcludedMatter(node)) {
    return null;
  }
  return {
    ...node,
    children: node.children.flatMap((child) => {
      const retained = pruneExcludedMatter(child);
      return retained ? [retained] : [];
    }),
  };
}

/** Keeps an editorial heading's outer level until its complete section ends. */
function filterEditorialHeadings(blocks: XmlElement[]): XmlElement[] {
  let excludedHeadingLevel: number | null = null;
  return blocks.filter((block) => {
    const headingLevel = /^h[1-6]$/u.test(block.name)
      ? Number(block.name.slice(1))
      : null;
    if (headingLevel !== null) {
      if (
        excludedHeadingLevel !== null &&
        headingLevel <= excludedHeadingLevel
      ) {
        excludedHeadingLevel = null;
      }
      if (
        excludedHeadingLevel === null &&
        isExcludedMatterLabel(textContent(block))
      ) {
        excludedHeadingLevel = headingLevel;
      }
    }
    return excludedHeadingLevel === null;
  });
}

export function preferredChapterTitle(
  navigationTitle: string | undefined,
  documentTitle: string | null,
  bookTitle: string,
  path: string,
): string {
  const navigation = meaningfulNavigationTitle(navigationTitle);
  const document = documentTitle?.trim();
  if (
    document &&
    normalizedLabel(document) === normalizedLabel(bookTitle) &&
    navigation
  ) {
    return document;
  }
  if (navigation) {
    return navigation;
  }
  if (document) {
    return document;
  }
  return fallbackTitle(path);
}

/** Removes publication preambles while retaining narrative images and dividers. */
export function contentBlocksWithoutPreamble(
  sourceBlocks: XmlElement[],
  bookTitle: string,
): XmlElement[] {
  const blocks = sourceBlocks.filter((block) => {
    const text = normalizeWhitespace(textContent(block)).trim();
    return (
      (text || elements(block, 'img').length > 0 || block.name === 'hr') &&
      !isBoilerplateText(text)
    );
  });
  if (!blocks.length) {
    return [];
  }
  const firstContentIndex = blocks.findIndex((block) => {
    const text = normalizeWhitespace(textContent(block)).trim();
    return (
      !isYear(text) && normalizedLabel(text) !== normalizedLabel(bookTitle)
    );
  });
  return blocks.filter((block, index) => {
    if (index > 2) {
      return true;
    }
    const text = normalizeWhitespace(textContent(block)).trim();
    return (
      index >= firstContentIndex &&
      !isYear(text) &&
      normalizedLabel(text) !== normalizedLabel(bookTitle)
    );
  });
}
