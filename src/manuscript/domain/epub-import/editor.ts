import type { XmlElement, XmlNode, ImageCatalog } from './types';
import {
  attribute,
  normalizeWhitespace,
  elements,
  textContent,
} from './archive';
import { imageSourceKey } from './images';

function trimInlineEdges(nodes: Record<string, unknown>[]): void {
  const textNodes = nodes.filter(
    (node) => node['type'] === 'text' && typeof node['text'] === 'string',
  );
  const first = textNodes[0];
  const last = textNodes.at(-1);
  if (first && typeof first['text'] === 'string') {
    first['text'] = first['text'].trimStart();
  }
  if (last && typeof last['text'] === 'string') {
    last['text'] = last['text'].trimEnd();
  }
  for (let index = nodes.length - 1; index >= 0; index -= 1) {
    if (nodes[index]?.['type'] === 'text' && !nodes[index]?.['text']) {
      nodes.splice(index, 1);
    }
  }
}

function safeLink(href: string | undefined): string | null {
  if (!href) {
    return null;
  }
  try {
    const url = new URL(href);
    return ['http:', 'https:', 'mailto:'].includes(url.protocol) ? href : null;
  } catch {
    return null;
  }
}

function marksForElement(
  node: XmlElement,
  inheritedMarks: Record<string, unknown>[],
): Record<string, unknown>[] {
  const markType: Record<string, string> = {
    b: 'bold',
    strong: 'bold',
    i: 'italic',
    em: 'italic',
    s: 'strike',
    strike: 'strike',
    del: 'strike',
    code: 'code',
  };
  const markName = markType[node.name];
  if (markName) {
    return [...inheritedMarks, { type: markName }];
  }
  if (node.name === 'a') {
    const href = safeLink(attribute(node, 'href'));
    return href
      ? [...inheritedMarks, { type: 'link', attrs: { href } }]
      : inheritedMarks;
  }
  return inheritedMarks;
}

/** Converts inline XML while preserving text order, marks and hard breaks. */
function inlineNodes(
  nodes: XmlNode[],
  inheritedMarks: Record<string, unknown>[] = [],
): Record<string, unknown>[] {
  const result: Record<string, unknown>[] = [];
  for (const node of nodes) {
    if (node.kind === 'text') {
      const text = normalizeWhitespace(node.value);
      if (text) {
        result.push({
          type: 'text',
          text,
          ...(inheritedMarks.length ? { marks: inheritedMarks } : {}),
        });
      }
      continue;
    }

    if (node.name === 'br') {
      result.push({ type: 'hardBreak' });
      continue;
    }
    if (node.name === 'img' || node.name === 'svg') {
      continue;
    }

    const marks = marksForElement(node, inheritedMarks);
    result.push(...inlineNodes(node.children, marks));
  }
  return collapseInlineWhitespace(result);
}

/** Collapses adjacent spaces across marks without moving text across hard breaks. */
function collapseInlineWhitespace(
  nodes: Record<string, unknown>[],
): Record<string, unknown>[] {
  let previousEndsWithSpace = false;
  return nodes.filter((node) => {
    if (typeof node['text'] !== 'string') {
      previousEndsWithSpace = false;
      return true;
    }
    if (previousEndsWithSpace) {
      node['text'] = node['text'].replace(/^ /u, '');
    }
    const text = node['text'] as string;
    if (text) {
      previousEndsWithSpace = text.endsWith(' ');
    }
    return Boolean(text);
  });
}

function numberWidth(value: string | undefined): number | null {
  if (!value) {
    return null;
  }
  const match = /^(\d+(?:\.\d+)?)(?:px)?$/i.exec(value.trim());
  if (!match?.[1]) {
    return null;
  }
  const width = Number(match[1]);
  return Number.isFinite(width) && width > 0 ? Math.round(width) : null;
}

function imageLayout(
  image: XmlElement,
  parent: XmlElement,
): { width: number | null; textFlow: string } {
  const style = attribute(image, 'style') ?? '';
  const parentClass = attribute(parent, 'class') ?? '';
  const width =
    numberWidth(attribute(image, 'width')) ??
    numberWidth(/(?:^|;)\s*width\s*:\s*([^;]+)/i.exec(style)?.[1]);
  if (parentClass.split(/\s+/u).includes('image--float-left')) {
    return { width, textFlow: 'text-right' };
  }
  if (parentClass.split(/\s+/u).includes('image--float-right')) {
    return { width, textFlow: 'text-left' };
  }
  return { width, textFlow: 'break' };
}

function dividerNode(element: XmlElement): Record<string, unknown> {
  const image = elements(element, 'img')[0];
  const source = image ? (attribute(image, 'src') ?? '') : '';
  const match =
    /divider-(flourish|diamonds|stars|waves|dots|asterisks|moon)(?:-[0-9a-f]{6})?\.svg(?:[?#]|$)/i.exec(
      source,
    );
  const style = attribute(element, 'style') ?? '';
  const color = /(?:^|;)\s*color\s*:\s*(#[0-9a-f]{6})/i.exec(style)?.[1];
  return {
    type: 'sceneDivider',
    attrs: {
      variant: match?.[1]?.toLowerCase() ?? 'flourish',
      ...(color ? { color: color.toLowerCase() } : {}),
    },
  };
}

function makeImageNode(
  image: XmlElement,
  parent: XmlElement,
  documentPath: string,
  catalog: ImageCatalog,
): Record<string, unknown>[] {
  const source = attribute(image, 'src');
  if (!source) {
    return [];
  }
  const key = imageSourceKey(documentPath, source);
  const assetId = catalog.bySource.get(key);
  if (!assetId) {
    return [];
  }

  const layout = imageLayout(image, parent);
  return [
    {
      type: 'image',
      attrs: {
        src: '',
        storageKey: null,
        alt: attribute(image, 'alt') ?? '',
        width: layout.width,
        textFlow: layout.textFlow,
        epubAssetId: assetId,
      },
    },
  ];
}

function paragraphContent(
  nodes: XmlNode[],
  imageParent: XmlElement,
  documentPath: string,
  catalog: ImageCatalog,
  inheritedMarks: Record<string, unknown>[] = [],
): Record<string, unknown>[] {
  const result: Record<string, unknown>[] = [];
  let inline: XmlNode[] = [];
  const flushInline = (): void => {
    const content = inlineNodes(inline, inheritedMarks);
    trimInlineEdges(content);
    if (content.length) {
      result.push({ type: 'paragraph', content });
    }
    inline = [];
  };

  for (const node of nodes) {
    if (node.kind === 'element' && node.name === 'img') {
      flushInline();
      result.push(...makeImageNode(node, imageParent, documentPath, catalog));
    } else if (node.kind === 'element' && elements(node, 'img').length > 0) {
      flushInline();
      const classes = (attribute(node, 'class') ?? '').split(/\s+/u);
      const parent = classes.some((value) =>
        ['image--float-left', 'image--float-right'].includes(value),
      )
        ? node
        : imageParent;
      result.push(
        ...paragraphContent(
          node.children,
          parent,
          documentPath,
          catalog,
          marksForElement(node, inheritedMarks),
        ),
      );
    } else {
      inline.push(node);
    }
  }

  flushInline();
  return result;
}

function paragraph(
  element: XmlElement,
  documentPath: string,
  catalog: ImageCatalog,
): Record<string, unknown>[] {
  if (
    (attribute(element, 'class') ?? '').split(/\s+/u).includes('scene-divider')
  ) {
    return [dividerNode(element)];
  }

  return paragraphContent(element.children, element, documentPath, catalog);
}

const IGNORED_BLOCK_TAGS = new Set(['script', 'style', 'head', 'title']);

const BLOCK_TAGS = new Set([
  'p',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'blockquote',
  'ul',
  'ol',
  'hr',
  'pre',
  'div',
  'section',
  'article',
  'main',
  'figure',
  'img',
]);

function listBlock(
  element: XmlElement,
  documentPath: string,
  catalog: ImageCatalog,
): Record<string, unknown>[] {
  const listItems = element.children
    .filter(
      (item): item is XmlElement =>
        item.kind === 'element' && item.name === 'li',
    )
    .map((item) => {
      const content = parseBlocks(item, documentPath, catalog);
      return {
        type: 'listItem',
        content: content.length ? content : [{ type: 'paragraph' }],
      };
    });
  if (!listItems.length) {
    return [];
  }
  return [
    {
      type: element.name === 'ul' ? 'bulletList' : 'orderedList',
      ...(element.name === 'ol' && attribute(element, 'start')
        ? { attrs: { start: Number(attribute(element, 'start')) || 1 } }
        : {}),
      content: listItems,
    },
  ];
}

function blockContent(
  child: XmlElement,
  parent: XmlElement,
  documentPath: string,
  catalog: ImageCatalog,
): Record<string, unknown>[] {
  if (child.name === 'p') {
    return paragraph(child, documentPath, catalog);
  }
  if (/^h[1-6]$/u.test(child.name)) {
    const content = inlineNodes(child.children);
    trimInlineEdges(content);
    return content.length
      ? [
          {
            type: 'heading',
            attrs: { level: Number(child.name.slice(1)) },
            content,
          },
        ]
      : [];
  }
  if (child.name === 'hr') {
    return [{ type: 'horizontalRule' }];
  }
  if (child.name === 'img') {
    return makeImageNode(child, parent, documentPath, catalog);
  }
  if (child.name === 'ul' || child.name === 'ol') {
    return listBlock(child, documentPath, catalog);
  }
  if (child.name === 'blockquote') {
    const content = parseBlocks(child, documentPath, catalog);
    return content.length ? [{ type: 'blockquote', content }] : [];
  }
  if (child.name === 'pre') {
    const text = textContent(child);
    return text
      ? [{ type: 'codeBlock', content: [{ type: 'text', text }] }]
      : [];
  }
  return parseBlocks(child, documentPath, catalog);
}

function parseBlocks(
  element: XmlElement,
  documentPath: string,
  catalog: ImageCatalog,
): Record<string, unknown>[] {
  const result: Record<string, unknown>[] = [];
  let inline: XmlNode[] = [];
  const flushInline = (): void => {
    const content = inlineNodes(inline);
    trimInlineEdges(content);
    if (content.length) {
      result.push({ type: 'paragraph', content });
    }
    inline = [];
  };

  for (const child of element.children) {
    if (child.kind === 'text') {
      inline.push(child);
      continue;
    }
    if (IGNORED_BLOCK_TAGS.has(child.name)) {
      continue;
    }
    if (!BLOCK_TAGS.has(child.name)) {
      if (elements(child, 'img').length > 0) {
        flushInline();
        result.push(
          ...paragraphContent([child], element, documentPath, catalog),
        );
      } else {
        inline.push(child);
      }
      continue;
    }

    flushInline();
    result.push(...blockContent(child, element, documentPath, catalog));
  }

  flushInline();
  return result;
}

export function parseContentGroup(
  blocks: XmlElement[],
  documentPath: string,
  catalog: ImageCatalog,
): Record<string, unknown> {
  const wrapper: XmlElement = {
    kind: 'element',
    name: 'div',
    attributes: {},
    children: blocks,
  };
  const content = parseBlocks(wrapper, documentPath, catalog);
  return {
    type: 'doc',
    content: content.length ? content : [{ type: 'paragraph' }],
  };
}
