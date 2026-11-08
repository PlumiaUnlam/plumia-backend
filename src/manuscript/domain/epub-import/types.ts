import type JSZip from 'jszip';

export type JSZipObject = JSZip.JSZipObject;

export class EpubImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EpubImportError';
  }
}

export class ArchiveEntryTooLargeError extends Error {}

export class EpubArchiveLimitError extends EpubImportError {}

export interface DecompressionBudget {
  decompressedBytes: number;
}

interface XmlText {
  kind: 'text';
  value: string;
}

export interface XmlElement {
  kind: 'element';
  name: string;
  attributes: Record<string, string>;
  children: XmlNode[];
  boundaryIds?: string[];
}

export type XmlNode = XmlText | XmlElement;

export interface EpubImportImage {
  id: string;
  buffer: Buffer;
  contentType: string;
  extension: string;
}

export interface EpubImportScene {
  title: string;
  content: Record<string, unknown>;
}

export interface EpubImportChapter {
  title: string;
  scenes: EpubImportScene[];
}

export interface ParsedEpub {
  title: string;
  chapters: EpubImportChapter[];
  images: Map<string, EpubImportImage>;
  skippedImages: number;
}

export interface ImageCatalog {
  bySource: Map<string, string | null>;
  images: Map<string, EpubImportImage>;
  skippedSources: Set<string>;
}

export interface JSZipNodeStream extends NodeJS.ReadableStream {
  destroy(error?: Error): this;
  _helper?: {
    pause(): unknown;
  };
}

export interface EpubNavigation {
  titles: Map<string, string>;
  promotionalTargets: Set<string>;
}

export interface ContentBoundary {
  kind: 'chapter' | 'scene';
  title: string;
  consumeNext?: boolean;
  preserveBlock?: boolean;
}

export interface LogicalChapterState {
  chapters: EpubImportChapter[];
  currentChapter: EpubImportChapter | null;
  currentSceneTitle: string;
  currentSceneBlocks: XmlElement[];
  preludeBlocks: XmlElement[];
}

export interface EpubPackage {
  opfPath: string;
  title: string;
  manifestById: Map<string, XmlElement>;
  spineItems: XmlElement[];
  navigationTitles: Map<string, string>;
  promotionalTargets: Set<string>;
}

export interface PromotionState {
  excluded: boolean;
}
