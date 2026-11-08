import type JSZip from 'jszip';
import { mapSequentially } from '../../common/async.utils';
import type {
  XmlElement,
  DecompressionBudget,
  EpubPackage,
  ImageCatalog,
  PromotionState,
  EpubImportChapter,
  ParsedEpub,
} from './epub-import/types';
import { EpubImportError } from './epub-import/types';
import {
  normalizedLabel,
  elements,
  textContent,
  parseXml,
  readArchiveText,
  attribute,
  archivePath,
  blockIds,
  appendContent,
  documentHasText,
  loadEpubArchive,
  asRecord,
} from './epub-import/archive';
import {
  stripTrailingDigits,
  EDITORIAL_FILE_STEMS,
  isExcludedMatterLabel,
  isExcludedMatter,
  isBoilerplateText,
  leadingRomanChapterNumber,
} from './epub-import/structure';
import {
  contentBlocks,
  chapterTitleFromDocument,
  preferredChapterTitle,
} from './epub-import/content';
import { tocTitles } from './epub-import/navigation';
import { catalogImages } from './epub-import/images';
import { logicalChapters } from './epub-import/chapters';

export { EpubImportError } from './epub-import/types';
export { MAX_EPUB_FILE_SIZE } from './epub-import/archive';
export type {
  EpubImportImage,
  EpubImportScene,
  EpubImportChapter,
  ParsedEpub,
} from './epub-import/types';

const XHTML_MEDIA_TYPES = new Set([
  'application/xhtml+xml',
  'text/html',
  'application/x-dtbook+xml',
]);

/** Excludes identified editorial documents before importing their content. */
function isFrontMatterDocument(
  path: string,
  navigationTitle: string | undefined,
  root: XmlElement,
): boolean {
  const decodedPath = (() => {
    try {
      return decodeURIComponent(path);
    } catch {
      return path;
    }
  })();
  const normalizedPath = normalizedLabel(decodedPath).replaceAll('\\', '/');
  const fileName = normalizedPath.split('/').pop() ?? normalizedPath;
  const fileStem = stripTrailingDigits(fileName.split(/[._-]/u, 1)[0]!);
  if (EDITORIAL_FILE_STEMS.has(fileStem)) {
    return true;
  }

  const label = normalizedLabel(navigationTitle);
  if (isExcludedMatterLabel(label) || isExcludedMatter(root)) {
    return true;
  }

  const body = elements(root, 'body')[0] ?? root;
  if (isExcludedMatter(body)) {
    return true;
  }
  const visibleText = contentBlocks(body)
    .map((block) => textContent(block))
    .join(' ');
  const wordCount = visibleText.trim().split(/\s+/u).filter(Boolean).length;
  return isBoilerplateText(visibleText) && wordCount < 180;
}

/** Loads package metadata, manifest, spine and navigation from the container. */
async function readEpubPackage(
  zip: JSZip,
  budget: DecompressionBudget,
): Promise<EpubPackage> {
  const container = parseXml(
    await readArchiveText(zip, 'META-INF/container.xml', budget),
  );
  const rootfile = elements(container, 'rootfile')[0];
  const opfHref = rootfile ? attribute(rootfile, 'full-path') : undefined;
  if (!opfHref) {
    throw new EpubImportError('El EPUB no indica dónde está su catálogo.');
  }

  const opfPath = archivePath('META-INF/container.xml', `../${opfHref}`);
  const packageRoot = parseXml(await readArchiveText(zip, opfPath, budget));
  const metadata = elements(packageRoot, 'metadata')[0] ?? packageRoot;
  const titleNode = elements(metadata, 'title')[0];
  const title = titleNode ? textContent(titleNode).trim() : '';
  const manifest = elements(packageRoot, 'item');
  const spine = elements(packageRoot, 'spine')[0];
  if (!spine || !manifest.length) {
    throw new EpubImportError('El EPUB no contiene capítulos para importar.');
  }

  const manifestById = new Map(
    manifest
      .map((item) => [attribute(item, 'id') ?? '', item] as const)
      .filter(([id]) => id),
  );
  const navigation = await tocTitles(zip, opfPath, manifest, budget);
  return {
    opfPath,
    title,
    manifestById,
    spineItems: elements(spine, 'itemref'),
    navigationTitles: navigation.titles,
    promotionalTargets: navigation.promotionalTargets,
  };
}

function spineItemPath(
  itemref: XmlElement,
  packageData: EpubPackage,
  opfPath: string,
): string | null {
  if (attribute(itemref, 'linear') === 'no') {
    return null;
  }
  const item = packageData.manifestById.get(attribute(itemref, 'idref') ?? '');
  const href = item ? attribute(item, 'href') : undefined;
  const mediaType = item ? attribute(item, 'media-type') : undefined;
  if (
    !item ||
    !href ||
    !mediaType ||
    !XHTML_MEDIA_TYPES.has(mediaType.toLowerCase()) ||
    (attribute(item, 'properties') ?? '').split(/\s+/u).includes('nav')
  ) {
    return null;
  }
  return archivePath(opfPath, href);
}

/** Filters and imports one spine document with its navigation scope. */
async function parseSpineDocument(
  zip: JSZip,
  itemref: XmlElement,
  packageData: EpubPackage,
  opfPath: string,
  catalog: ImageCatalog,
  budget: DecompressionBudget,
  promotion: PromotionState,
): Promise<EpubImportChapter[]> {
  const path = spineItemPath(itemref, packageData, opfPath);
  if (!path) {
    return [];
  }
  const source = await readArchiveText(zip, path, budget);
  const root = parseXml(source);
  const navigationTitle = packageData.navigationTitles.get(path);
  if (navigationTitle) {
    promotion.excluded = packageData.promotionalTargets.has(path);
  }
  if (isFrontMatterDocument(path, navigationTitle, root)) {
    return [];
  }

  const body = elements(root, 'body')[0] ?? root;
  const editorialContainerIds = new Set(
    [...packageData.navigationTitles]
      .filter(
        ([key, title]) =>
          key.startsWith(`${path}#`) && isExcludedMatterLabel(title),
      )
      .map(([key]) => key.slice(path.length + 1)),
  );
  const blocks = filterNavigationSections(
    contentBlocks(body, editorialContainerIds),
    path,
    packageData,
    promotion,
  );
  const retainedRoot: XmlElement = { ...body, children: blocks };
  await catalogImages(zip, retainedRoot, path, catalog, budget);
  const documentTitle = chapterTitleFromDocument(blocks, packageData.title);
  const chapterTitle = preferredChapterTitle(
    navigationTitle,
    documentTitle,
    packageData.title,
    path,
  );
  return logicalChapters(
    blocks,
    path,
    catalog,
    packageData.title,
    chapterTitle,
    packageData.navigationTitles,
  );
}

/** Identifies a narrative chapter boundary that resumes after a non-heading editorial target. */
function isReliableNarrativeBoundary(
  block: XmlElement,
  title: string,
): boolean {
  const normalizedTitle = normalizedLabel(title);
  return (
    block.name === 'h1' ||
    /^(?:act|acto|capitulo|chapter|parte|part)\b/u.test(normalizedTitle) ||
    leadingRomanChapterNumber(title) !== null
  );
}

/** Filters TOC-labeled editorial ranges while allowing explicit narrative destinations to resume. */
function filterNavigationSections(
  blocks: XmlElement[],
  path: string,
  book: EpubPackage,
  promotion: PromotionState,
): XmlElement[] {
  let editorialLevel: number | null = null;
  return blocks.filter((block) => {
    const key = blockIds(block)
      .map((id) => `${path}#${id}`)
      .find((id) => book.navigationTitles.has(id));
    const level = /^h[1-6]$/u.test(block.name)
      ? Number(block.name.slice(1))
      : 7;
    if (key) {
      promotion.excluded = book.promotionalTargets.has(key);
      const title = book.navigationTitles.get(key)!;
      if (isExcludedMatterLabel(title)) {
        editorialLevel = level;
      } else if (
        editorialLevel !== 7 ||
        isReliableNarrativeBoundary(block, title)
      ) {
        editorialLevel = null;
      }
    } else if (
      editorialLevel === 7 &&
      isReliableNarrativeBoundary(block, textContent(block))
    ) {
      editorialLevel = null;
    } else if (
      editorialLevel !== null &&
      editorialLevel < 7 &&
      level <= editorialLevel &&
      level < 7
    ) {
      editorialLevel = null;
    }
    return !promotion.excluded && editorialLevel === null;
  });
}

function mergeLeadingIntroduction(
  chapters: EpubImportChapter[],
  documentChapters: EpubImportChapter[],
): void {
  const leadingFragment = documentChapters[0];
  const nextChapter = documentChapters[1];
  const previousChapter = chapters.at(-1);
  const previousNumber = previousChapter
    ? leadingRomanChapterNumber(previousChapter.title)
    : null;
  const nextNumber = nextChapter
    ? leadingRomanChapterNumber(nextChapter.title)
    : null;
  if (
    !leadingFragment ||
    normalizedLabel(leadingFragment.title) !== 'introduccion' ||
    leadingFragment.scenes.length !== 1 ||
    !previousChapter?.scenes.length ||
    previousNumber === null ||
    nextNumber !== previousNumber + 1
  ) {
    return;
  }
  const previousScene = previousChapter.scenes.at(-1);
  const fragmentScene = leadingFragment.scenes[0];
  if (previousScene && fragmentScene) {
    if (appendContent(previousScene.content, fragmentScene.content)) {
      documentChapters.shift();
    }
  }
}

/** Imports spine documents sequentially and preserves standalone illustrations. */
async function parseSpine(
  zip: JSZip,
  opfPath: string,
  packageData: EpubPackage,
  catalog: ImageCatalog,
  budget: DecompressionBudget,
): Promise<EpubImportChapter[]> {
  const chapters: EpubImportChapter[] = [];
  const promotion: PromotionState = { excluded: false };
  const leadingIllustrations: EpubImportChapter[] = [];
  await mapSequentially(packageData.spineItems, async (itemref) => {
    const documentChapters = await parseSpineDocument(
      zip,
      itemref,
      packageData,
      opfPath,
      catalog,
      budget,
      promotion,
    );
    // Standalone illustration pages belong to the preceding text, not a filler chapter.
    if (
      documentChapters.length === 1 &&
      documentChapters[0]!.scenes.every(
        (scene) => !documentHasText(scene.content),
      )
    ) {
      const previous = chapters.at(-1)?.scenes.at(-1);
      if (previous) {
        for (const scene of documentChapters[0]!.scenes) {
          appendContent(previous.content, scene.content);
        }
      } else {
        leadingIllustrations.push(...documentChapters);
      }
      return;
    }
    prependLeadingIllustrations(leadingIllustrations, documentChapters);
    mergeLeadingIntroduction(chapters, documentChapters);
    chapters.push(...documentChapters);
    if (chapters.length > 500) {
      throw new EpubImportError('El EPUB supera el máximo de 500 capítulos.');
    }
  });
  chapters.push(...leadingIllustrations);
  if (!chapters.length) {
    throw new EpubImportError('No se encontró texto importable en el EPUB.');
  }
  return chapters;
}

/** Buffers illustration pages until a first scene can own them, preserving reading order. */
function prependLeadingIllustrations(
  pending: EpubImportChapter[],
  chapters: EpubImportChapter[],
): void {
  const first = chapters[0]?.scenes[0];
  if (!first || !pending.length) {
    return;
  }
  const content: Record<string, unknown> = { type: 'doc', content: [] };
  for (const chapter of pending) {
    for (const scene of chapter.scenes) {
      appendContent(content, scene.content);
    }
  }
  appendContent(content, first.content);
  first.content = content;
  pending.length = 0;
}

export async function parseEpubArchive(buffer: Buffer): Promise<ParsedEpub> {
  const budget: DecompressionBudget = { decompressedBytes: 0 };
  const zip = await loadEpubArchive(buffer, budget);
  const packageData = await readEpubPackage(zip, budget);
  const catalog: ImageCatalog = {
    bySource: new Map(),
    images: new Map(),
    skippedSources: new Set(),
  };
  const chapters = await parseSpine(
    zip,
    packageData.opfPath,
    packageData,
    catalog,
    budget,
  );

  return {
    title: (packageData.title.trim()
      ? packageData.title
      : (chapters[0]?.title ?? 'Obra importada')
    ).slice(0, 200),
    chapters,
    images: catalog.images,
    skippedImages: catalog.skippedSources.size,
  };
}

export function imageIdFromNode(node: Record<string, unknown>): string | null {
  const attrs = asRecord(node['attrs']);
  return typeof attrs?.['epubAssetId'] === 'string'
    ? attrs['epubAssetId']
    : null;
}
