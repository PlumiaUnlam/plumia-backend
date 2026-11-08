import type JSZip from 'jszip';
import type {
  XmlElement,
  DecompressionBudget,
  EpubNavigation,
  XmlNode,
} from './types';
import { EpubArchiveLimitError } from './types';
import {
  elements,
  attribute,
  textContent,
  archivePath,
  normalizeWhitespace,
  parseXml,
  readArchiveText,
  normalizedLabel,
} from './archive';
import {
  semanticTypes,
  leadingRomanChapterNumber,
  isExcludedMatterLabel,
} from './structure';

/** Reads EPUB 3 chapter labels without mixing in landmarks or pagination. */
function navigationTitles(
  root: XmlElement,
  navPath: string,
): Map<string, string> {
  const titles = new Map<string, string>();
  const navs = elements(root, 'nav');
  const toc = navs.find((nav) => semanticTypes(nav).includes('toc'));
  // Page lists and landmarks are separate navigation aids, never chapter titles.
  let roots = navs.filter((nav) => !semanticTypes(nav).length);
  if (toc) {
    roots = [toc];
  } else if (!navs.length) {
    roots = [root];
  }
  for (const link of roots.flatMap((nav) => elements(nav, 'a'))) {
    const href = attribute(link, 'href');
    const label = textContent(link).trim();
    if (href && label) {
      addNavigationTitle(titles, navPath, href, label);
    }
  }
  return titles;
}

/** Records a unique destination, skipping only malformed URI fragments. */
function addNavigationTitle(
  titles: Map<string, string>,
  base: string,
  href: string,
  label: string,
): void {
  const path = archivePath(base, href);
  const fragment = href.split('#')[1];
  let key = path;
  if (fragment) {
    try {
      key = `${path}#${decodeURIComponent(fragment)}`;
    } catch (error) {
      if (error instanceof URIError) {
        return;
      }
      throw error;
    }
  }
  if (!titles.has(key)) {
    titles.set(key, normalizeWhitespace(label).trim());
  }
}

/** Reads EPUB 2 navPoint destinations and labels in navigation order. */
function ncxTitles(root: XmlElement, navPath: string): Map<string, string> {
  const titles = new Map<string, string>();
  for (const point of elements(root, 'navpoint')) {
    const content = elements(point, 'content')[0];
    const navLabel = elements(point, 'text')[0];
    const contentSrc = content ? attribute(content, 'src') : undefined;
    const label = navLabel ? textContent(navLabel).trim() : '';
    if (contentSrc && label) {
      addNavigationTitle(titles, navPath, contentSrc, label);
    }
  }
  return titles;
}

/** Loads optional navigation while preserving archive-budget failures. */
export async function tocTitles(
  zip: JSZip,
  opfPath: string,
  manifest: XmlElement[],
  budget: DecompressionBudget,
): Promise<EpubNavigation> {
  const navItem = manifest.find((item) =>
    (attribute(item, 'properties') ?? '').split(/\s+/u).includes('nav'),
  );
  const ncxItem = manifest.find(
    (item) => attribute(item, 'media-type') === 'application/x-dtbncx+xml',
  );
  // EPUB 3 declares a nav document and may also ship an NCX. If the nav document cannot be
  // used (missing or invalid href, unreadable or malformed), the NCX keeps the chapter
  // fragments and titles so chapters distinguished only by them are not merged.
  const candidates = [navItem, ncxItem].filter(
    (candidate, index, all): candidate is XmlElement =>
      candidate !== undefined && all.indexOf(candidate) === index,
  );
  for (const item of candidates) {
    const href = attribute(item, 'href');
    if (!href) {
      continue;
    }
    try {
      const navPath = archivePath(opfPath, href);
      const root = parseXml(await readArchiveText(zip, navPath, budget));
      const titles =
        item === navItem
          ? navigationTitles(root, navPath)
          : ncxTitles(root, navPath);
      return {
        titles,
        promotionalTargets: promotionalNavigationTargets(root, navPath, titles),
      };
    } catch (error) {
      if (error instanceof EpubArchiveLimitError) {
        throw error;
      }
    }
  }
  return { titles: new Map(), promotionalTargets: new Set() };
}

const PROMOTIONAL_LABELS = new Set([
  'seguir leyendo',
  'read on',
  'extracto',
  'adelanto',
  'preview',
  'sample',
]);

/** Recognizes navigation labels that introduce promotional inserts. */
function isPromotionalLabel(label: string): boolean {
  return PROMOTIONAL_LABELS.has(normalizedLabel(label));
}

/** Reads explicit TOC nesting so sample chapters cannot resume the main narrative. */
function nestedPromotionalTargets(root: XmlElement, path: string): Set<string> {
  const targets = new Set<string>();
  const visit = (node: XmlNode, inherited: boolean): void => {
    if (node.kind === 'text') {
      return;
    }
    const entries = directNavigationEntry(node, path);
    const promotional =
      inherited || [...entries.values()].some(isPromotionalLabel);
    if (promotional) {
      for (const key of entries.keys()) {
        targets.add(key);
      }
    }
    for (const child of node.children) {
      visit(child, promotional);
    }
  };
  visit(root, false);
  return targets;
}

/** Reads only the current list item/navPoint, leaving nested entries to the traversal. */
function directNavigationEntry(
  node: XmlElement,
  path: string,
): Map<string, string> {
  const entries = new Map<string, string>();
  if (node.name !== 'li' && node.name !== 'navpoint') {
    return entries;
  }
  const children = node.children.filter(
    (child): child is XmlElement => child.kind === 'element',
  );
  const isListItem = node.name === 'li';
  const targetName = isListItem ? 'a' : 'content';
  const target = children.find((child) => child.name === targetName);
  const label = isListItem
    ? target
    : children.find((child) => child.name === 'navlabel');
  const hrefAttribute = isListItem ? 'href' : 'src';
  const href = target ? attribute(target, hrefAttribute) : undefined;
  if (label && href) {
    addNavigationTitle(entries, path, href, textContent(label));
  }
  return entries;
}

/** Reads a leading Arabic or Roman chapter number from a TOC label. */
function navigationChapterNumber(title: string): number | null {
  const match = /^(?:capitulo\s+|chapter\s+)?(\d+)(?:[.)]|\s|$)/u.exec(
    normalizedLabel(title),
  );
  return match ? Number(match[1]) : leadingRomanChapterNumber(title);
}

/** Bounds flat promotional inserts by the next main chapter, respecting nested sample entries. */
function promotionalNavigationTargets(
  root: XmlElement,
  path: string,
  titles: Map<string, string>,
): Set<string> {
  const targets = nestedPromotionalTargets(root, path);
  let inPromotion = false;
  let previousNumber: number | null = null;
  for (const [key, title] of titles) {
    const explicitPromotion = targets.has(key) || isPromotionalLabel(title);
    const number = navigationChapterNumber(title);
    if (explicitPromotion) {
      inPromotion = true;
    } else if (
      inPromotion &&
      resumesMainNarrative(title, number, previousNumber)
    ) {
      inPromotion = false;
    }
    if (inPromotion) {
      targets.add(key);
    } else if (number !== null) {
      previousNumber = number;
    }
  }
  return targets;
}

/** Recognizes later main entries while avoiding restarted excerpt numbering. */
function resumesMainNarrative(
  title: string,
  number: number | null,
  previousNumber: number | null,
): boolean {
  if (isExcludedMatterLabel(title)) {
    return false;
  }
  if (previousNumber === null) {
    return true;
  }
  if (number !== null) {
    return number > previousNumber;
  }
  // Flat TOCs can label an excerpt with its other book's title followed by "Chapter 1".
  const excerptNumber = /\b(?:capitulo|chapter)\s+(\d+)\b/u.exec(
    normalizedLabel(title),
  );
  return !excerptNumber || Number(excerptNumber[1]) > previousNumber;
}
