import {
  normalizeWhitespace,
  normalizedLabel,
  attribute,
  textContent,
} from './archive';
import type { XmlElement, ContentBoundary } from './types';

export function isBoilerplateText(value: string): boolean {
  const text = normalizeWhitespace(value).toLowerCase();
  return (
    /libro descargado en www\.elejandria\.com/u.test(text) ||
    /gracias por leer este libro/u.test(text) ||
    /descubre nuestra colección de obras/u.test(text)
  );
}

export function isYear(value: string): boolean {
  return /^\d{4}[.]?$/u.test(value.trim());
}

export function isRomanNumeral(value: string): boolean {
  return /^(?=[ivxlcdm]+$)[ivxlcdm]+[.]?$/iu.test(value.trim());
}

function romanNumeralValue(value: string): number | null {
  const numeral = value.replace(/[.]$/u, '').toUpperCase();
  if (!isRomanNumeral(numeral)) {
    return null;
  }

  const values: Record<string, number> = {
    I: 1,
    V: 5,
    X: 10,
    L: 50,
    C: 100,
    D: 500,
    M: 1000,
  };
  let total = 0;
  for (let index = 0; index < numeral.length; index += 1) {
    const current = values[numeral[index]!]!;
    const next = values[numeral[index + 1] ?? ''] ?? 0;
    total += current < next ? -current : current;
  }
  return total;
}

export function leadingRomanChapterNumber(title: string): number | null {
  const match = /^\s*([ivxlcdm]+)[.)]\s+/iu.exec(title);
  return match ? romanNumeralValue(match[1]!) : null;
}

function isGenericNavigationTitle(value: string | undefined): boolean {
  return ['start', 'inicio', 'home', 'contents', 'table of contents'].includes(
    normalizedLabel(value),
  );
}

/** Quita los dígitos finales sin regex con retroceso (evita backtracking cuadrático). */
export function stripTrailingDigits(value: string): string {
  let end = value.length;
  while (end > 0) {
    const codePoint = value.codePointAt(end - 1) ?? -1;
    if (codePoint < 48 || codePoint > 57) {
      break;
    }
    end -= 1;
  }
  return value.slice(0, end);
}

export function semanticTypes(node: XmlElement): string[] {
  return (attribute(node, 'type') ?? '')
    .toLowerCase()
    .split(/\s+/u)
    .filter(Boolean);
}

const EXCLUDED_MATTER_TYPES = new Set([
  'cover',
  'titlepage',
  'copyright-page',
  'toc',
  'landmarks',
  'page-list',
  'dedication',
  'acknowledgments',
  'colophon',
  'contributors',
  'biography',
  'bibliography',
  'index',
  'rearnotes',
  'endnotes',
]);

export function isExcludedMatter(node: XmlElement): boolean {
  return semanticTypes(node).some((type) => EXCLUDED_MATTER_TYPES.has(type));
}

/** Matches normalized editorial labels without a complex alternation regex. */
export function isExcludedMatterLabel(value: string): boolean {
  return EDITORIAL_LABELS.has(normalizedLabel(value));
}

export const EDITORIAL_FILE_STEMS = new Set([
  'cover',
  'coverpage',
  'title',
  'titlepage',
  'portada',
  'cubierta',
  'titulo',
  'nav',
  'toc',
  'content',
  'contents',
  'about',
  'acerca',
  'colophon',
  'copyright',
  'elejandria',
  'sinopsis',
  'synopsis',
  'info',
  'autor',
  'author',
  'dedicatoria',
  'dedication',
  'acknowledgment',
  'acknowledgments',
  'acknowledgement',
  'acknowledgements',
  'agradecimientos',
  'credits',
  'creditos',
]);

const EDITORIAL_LABELS = new Set([
  'cover',
  'cubierta',
  'portada',
  'title',
  'title page',
  'titulo',
  'acerca',
  'acerca del autor',
  'about',
  'about the author',
  'autor',
  'author',
  'sinopsis',
  'synopsis',
  'dedicatoria',
  'dedication',
  'agradecimientos',
  'acknowledgments',
  'acknowledgements',
  'indice',
  'contents',
  'table of contents',
  'creditos',
  'pagina de creditos',
  'credits',
  'copyright',
  'colofon',
  'colophon',
  'pottermore publishing',
  'tambien por',
  'also by',
  'seguir leyendo',
  'read on',
]);

const CHAPTER_PREFIXES = new Set([
  'acto',
  'act',
  'capitulo',
  'chapter',
  'parte',
  'part',
]);

const SCENE_PREFIXES = new Set(['escena', 'scene']);

const CHAPTER_ORDINALS = new Set([
  'primero',
  'primera',
  'segundo',
  'segunda',
  'tercero',
  'tercera',
  'cuarto',
  'cuarta',
  'quinto',
  'quinta',
  'sexto',
  'sexta',
  'septimo',
  'septima',
  'octavo',
  'octava',
  'noveno',
  'novena',
  'decimo',
  'decima',
]);

const SCENE_ORDINALS = new Set([
  'primera',
  'primero',
  'segunda',
  'segundo',
  'tercera',
  'tercero',
  'cuarta',
  'cuarto',
  'quinta',
  'quinto',
  'sexta',
  'sexto',
  'septima',
  'septimo',
  'octava',
  'octavo',
]);

const NAMED_CHAPTERS = new Set(['personajes', 'prologo']);

function startsWithBoundaryNumber(
  label: string,
  prefixes: Set<string>,
  ordinals: Set<string>,
): boolean {
  const match = /^(\S+)\s+([a-z0-9]+)\b/u.exec(label);
  if (!match || !prefixes.has(match[1]!)) {
    return false;
  }
  const number = match[2]!;
  return (
    /^\d+$/u.test(number) || isRomanNumeral(number) || ordinals.has(number)
  );
}

function romanChapterBoundary(
  block: XmlElement,
  index: number,
  blocks: XmlElement[],
  romanChapterCount: number,
): ContentBoundary | null {
  if (
    romanChapterCount <= 1 ||
    !isRomanNumeral(normalizeWhitespace(textContent(block)).trim()) ||
    block.name !== 'p'
  ) {
    return null;
  }
  const next = blocks[index + 1];
  const nextText = next ? normalizeWhitespace(textContent(next)).trim() : '';
  const currentClass = attribute(block, 'class');
  const nextClass = next ? attribute(next, 'class') : undefined;
  if (
    next?.name !== 'p' ||
    !nextText ||
    nextText.length > 260 ||
    (currentClass && currentClass !== nextClass)
  ) {
    return null;
  }
  const numeral = normalizeWhitespace(textContent(block))
    .trim()
    .replace(/[.]$/u, '');
  return {
    kind: 'chapter',
    title: `${numeral}. ${nextText}`,
    consumeNext: true,
  };
}

function semanticChapterBoundary(
  block: XmlElement,
  label: string,
  bookTitle: string,
  text: string,
): ContentBoundary | null {
  const isSemanticHeading = block.name === 'h1' || block.name === 'h2';
  if (
    isSemanticHeading &&
    normalizedLabel(bookTitle) !== label &&
    !isGenericNavigationTitle(text) &&
    text.length <= 180
  ) {
    return { kind: 'chapter', title: text };
  }
  return null;
}

/** Infers chapter and scene boundaries from supported heading conventions. */
export function structuralBoundary(
  block: XmlElement,
  index: number,
  blocks: XmlElement[],
  bookTitle: string,
  romanChapterCount: number,
): ContentBoundary | null {
  const text = normalizeWhitespace(textContent(block)).trim();
  const label = normalizedLabel(text);
  if (!text || isBoilerplateText(text) || isYear(text)) {
    return null;
  }

  const combined = combinedHeadingBoundary(text, label, blocks[index + 1]);
  if (combined) {
    return combined;
  }

  if (startsWithBoundaryNumber(label, CHAPTER_PREFIXES, CHAPTER_ORDINALS)) {
    return { kind: 'chapter', title: text };
  }
  if (startsWithBoundaryNumber(label, SCENE_PREFIXES, SCENE_ORDINALS)) {
    return { kind: 'scene', title: text };
  }
  if (NAMED_CHAPTERS.has(label)) {
    return { kind: 'chapter', title: text };
  }
  if (label === 'introduccion') {
    return null;
  }

  const romanBoundary = romanChapterBoundary(
    block,
    index,
    blocks,
    romanChapterCount,
  );
  if (romanBoundary) {
    return romanBoundary;
  }

  return semanticChapterBoundary(block, label, bookTitle, text);
}

const CARDINAL_CHAPTER_NUMBERS = new Set([
  'uno',
  'dos',
  'tres',
  'cuatro',
  'cinco',
  'seis',
  'siete',
  'ocho',
  'nueve',
  'diez',
]);

/** Joins a bare chapter number to its subtitle; explicit TOC boundaries are resolved later. */
function combinedHeadingBoundary(
  text: string,
  label: string,
  next: XmlElement | undefined,
): ContentBoundary | null {
  const parts = label.split(' ');
  if (
    parts.length !== 2 ||
    !CHAPTER_PREFIXES.has(parts[0]!) ||
    !next ||
    !/^h[1-6]$/u.test(next.name)
  ) {
    return null;
  }
  const number = parts[1]!;
  if (
    !/^\d+$/u.test(number) &&
    !isRomanNumeral(number) &&
    !CARDINAL_CHAPTER_NUMBERS.has(number)
  ) {
    return null;
  }
  const subtitle = normalizeWhitespace(textContent(next)).trim();
  if (
    !subtitle ||
    subtitle.length > 180 ||
    startsWithBoundaryNumber(
      normalizedLabel(subtitle),
      CHAPTER_PREFIXES,
      CHAPTER_ORDINALS,
    ) ||
    startsWithBoundaryNumber(
      normalizedLabel(subtitle),
      SCENE_PREFIXES,
      SCENE_ORDINALS,
    )
  ) {
    return null;
  }
  return { kind: 'chapter', title: `${text}. ${subtitle}`, consumeNext: true };
}

export function meaningfulNavigationTitle(
  value: string | undefined,
): string | null {
  const title = value?.trim();
  if (
    !title ||
    isGenericNavigationTitle(title) ||
    isBoilerplateText(title) ||
    ['titulo', 'acerca', 'portada'].includes(normalizedLabel(title))
  ) {
    return null;
  }
  return title;
}
