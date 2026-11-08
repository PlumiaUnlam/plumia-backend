import type {
  LogicalChapterState,
  ImageCatalog,
  ContentBoundary,
  XmlElement,
  EpubImportChapter,
} from './types';
import { parseContentGroup } from './editor';
import { contentBlocksWithoutPreamble } from './content';
import {
  isRomanNumeral,
  structuralBoundary,
  isExcludedMatterLabel,
  meaningfulNavigationTitle,
} from './structure';
import {
  normalizeWhitespace,
  textContent,
  blockIds,
  normalizedLabel,
} from './archive';

function flushLogicalScene(
  state: LogicalChapterState,
  documentPath: string,
  catalog: ImageCatalog,
): void {
  if (!state.currentChapter || !state.currentSceneBlocks.length) {
    state.currentSceneBlocks = [];
    return;
  }
  state.currentChapter.scenes.push({
    title:
      state.currentSceneTitle === 'Texto'
        ? state.currentChapter.title
        : state.currentSceneTitle,
    content: parseContentGroup(state.currentSceneBlocks, documentPath, catalog),
  });
  state.currentSceneBlocks = [];
}

function flushLogicalChapter(
  state: LogicalChapterState,
  documentPath: string,
  catalog: ImageCatalog,
): void {
  flushLogicalScene(state, documentPath, catalog);
  if (state.currentChapter?.scenes.length) {
    state.chapters.push(state.currentChapter);
  }
  state.currentChapter = null;
  state.currentSceneTitle = 'Texto';
}

function processChapterBoundary(
  state: LogicalChapterState,
  boundary: ContentBoundary,
  defaultTitle: string,
  documentPath: string,
  catalog: ImageCatalog,
): void {
  if (boundary.kind === 'chapter') {
    if (!state.currentChapter && state.preludeBlocks.length) {
      state.currentChapter = { title: 'Introducción', scenes: [] };
      state.currentSceneTitle = 'Texto';
      state.currentSceneBlocks = state.preludeBlocks;
      state.preludeBlocks = [];
    }
    flushLogicalChapter(state, documentPath, catalog);
    state.currentChapter = { title: boundary.title.slice(0, 200), scenes: [] };
    return;
  }

  if (!state.currentChapter) {
    state.currentChapter = { title: defaultTitle, scenes: [] };
    state.currentSceneTitle = 'Texto';
    state.currentSceneBlocks = state.preludeBlocks;
    state.preludeBlocks = [];
  }
  flushLogicalScene(state, documentPath, catalog);
  state.currentSceneTitle = boundary.title.slice(0, 200);
}

function finishLogicalChapters(
  state: LogicalChapterState,
  defaultTitle: string,
  documentPath: string,
  catalog: ImageCatalog,
): void {
  if (!state.currentChapter && state.preludeBlocks.length) {
    state.currentChapter = { title: defaultTitle, scenes: [] };
    state.currentSceneBlocks = state.preludeBlocks;
  } else if (state.preludeBlocks.length) {
    flushLogicalChapter(state, documentPath, catalog);
    state.currentChapter = { title: 'Introducción', scenes: [] };
    state.currentSceneBlocks = state.preludeBlocks;
  }
  flushLogicalChapter(state, documentPath, catalog);
}

/** Builds logical chapters from retained blocks and explicit TOC destinations. */
export function logicalChapters(
  sourceBlocks: XmlElement[],
  documentPath: string,
  catalog: ImageCatalog,
  bookTitle: string,
  defaultTitle: string,
  navigation: Map<string, string>,
): EpubImportChapter[] {
  const blocks = contentBlocksWithoutPreamble(sourceBlocks, bookTitle);
  if (!blocks.length) {
    return [];
  }

  const romanChapterCount = blocks.filter((block) =>
    isRomanNumeral(normalizeWhitespace(textContent(block)).trim()),
  ).length;

  const boundaries = blocks.map((block, index) =>
    resolveContentBoundary(
      block,
      index,
      blocks,
      bookTitle,
      romanChapterCount,
      documentPath,
      navigation,
    ),
  );
  if (!boundaries.some(Boolean)) {
    return [
      {
        title: defaultTitle,
        scenes: [
          {
            title: defaultTitle,
            content: parseContentGroup(blocks, documentPath, catalog),
          },
        ],
      },
    ];
  }

  const state: LogicalChapterState = {
    chapters: [],
    currentChapter: null,
    currentSceneTitle: 'Texto',
    currentSceneBlocks: [],
    preludeBlocks: [],
  };
  for (const [index, block] of blocks.entries()) {
    const boundary = boundaries[index];
    if (index > 0 && boundaries[index - 1]?.consumeNext) {
      continue;
    }
    processLogicalBlock(
      state,
      block,
      boundary,
      defaultTitle,
      documentPath,
      catalog,
    );
  }

  finishLogicalChapters(state, defaultTitle, documentPath, catalog);

  applyDocumentNavigationTitle(
    state.chapters,
    defaultTitle,
    navigation.get(documentPath),
  );
  return state.chapters;
}

/** Resolves a block or flattened-container ID to its TOC title. */
function blockNavigationTitle(
  block: XmlElement,
  path: string,
  navigation: Map<string, string>,
): string | undefined {
  return blockIds(block)
    .map((id) => navigation.get(`${path}#${id}`))
    .find(Boolean);
}

/** Gives explicit TOC destinations precedence over inferred paired headings. */
function resolveContentBoundary(
  block: XmlElement,
  index: number,
  blocks: XmlElement[],
  bookTitle: string,
  romanCount: number,
  path: string,
  navigation: Map<string, string>,
): ContentBoundary | null {
  let boundary = structuralBoundary(
    block,
    index,
    blocks,
    bookTitle,
    romanCount,
  );
  const next = blocks[index + 1];
  if (
    boundary?.consumeNext &&
    next &&
    blockNavigationTitle(next, path, navigation)
  ) {
    boundary = {
      kind: 'chapter',
      title: normalizeWhitespace(textContent(block)).trim(),
    };
  }
  const title = blockNavigationTitle(block, path, navigation);
  if (!title || isExcludedMatterLabel(title)) {
    return boundary;
  }
  return {
    ...boundary,
    kind: 'chapter',
    title,
    preserveBlock:
      !boundary &&
      !/^h[1-6]$/u.test(block.name) &&
      normalizedLabel(textContent(block)) !== normalizedLabel(title),
  };
}

/** Advances chapter state while retaining prose used as an anchor destination. */
function processLogicalBlock(
  state: LogicalChapterState,
  block: XmlElement,
  boundary: ContentBoundary | null | undefined,
  defaultTitle: string,
  path: string,
  catalog: ImageCatalog,
): void {
  if (boundary) {
    processChapterBoundary(state, boundary, defaultTitle, path, catalog);
    if (boundary.preserveBlock) {
      state.currentSceneBlocks.push(block);
    }
  } else if (state.currentChapter) {
    state.currentSceneBlocks.push(block);
  } else {
    state.preludeBlocks.push(block);
  }
}

/** Applies a meaningful document-level title to its single logical chapter. */
function applyDocumentNavigationTitle(
  chapters: EpubImportChapter[],
  title: string,
  navigationTitle: string | undefined,
): void {
  if (chapters.length !== 1 || !meaningfulNavigationTitle(navigationTitle)) {
    return;
  }
  const chapter = chapters[0]!;
  const previousTitle = chapter.title;
  chapter.title = title.slice(0, 200);
  for (const scene of chapter.scenes) {
    if (scene.title === previousTitle) {
      scene.title = chapter.title;
    }
  }
}
