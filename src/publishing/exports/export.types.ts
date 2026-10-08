import type { ExportFormat, ExportStatus } from '@prisma/client';
import type { SceneDividerVariant } from './scene-divider';

export const EXPORT_FORMATS = ['EPUB'] as const;
export type SupportedExportFormat = (typeof EXPORT_FORMATS)[number];

export interface ExportJobRecord {
  id: string;
  projectId: string;
  bookId: string | null;
  format: ExportFormat;
  status: ExportStatus;
  progress: number;
  errorMessage: string | null;
  storageKey: string | null;
  fileSizeBytes: bigint | null;
  createdAt: Date;
  completedAt: Date | null;
}

export interface ExportImage {
  buffer: Buffer;
  mimeType: string;
  extension: string;
}

export type ExportInline =
  | {
      kind: 'text';
      text: string;
      bold: boolean;
      italic: boolean;
      href?: string;
    }
  | { kind: 'break' }
  | {
      kind: 'note';
      noteKind: ExportNoteKind;
      inlines: ExportInline[];
    };

export type ExportNoteKind = 'footnote' | 'endnote';

export interface ExportTextBlock {
  kind: 'paragraph' | 'heading' | 'blockquote' | 'codeBlock';
  inlines: ExportInline[];
  level?: number;
  textAlign?: string;
  lineHeight?: string;
  indentLeft?: number;
  indentRight?: number;
  firstLineIndent?: number;
}

export interface ExportListBlock {
  kind: 'bulletList' | 'orderedList';
  items: ExportBlock[][];
}

export type ExportBlock =
  | (ExportTextBlock & { kind: 'paragraph' })
  | (ExportTextBlock & { kind: 'heading' })
  | (ExportTextBlock & { kind: 'blockquote' })
  | (ExportTextBlock & { kind: 'codeBlock' })
  | (ExportListBlock & { kind: 'bulletList' })
  | (ExportListBlock & { kind: 'orderedList' })
  | { kind: 'sceneDivider'; variant: SceneDividerVariant }
  | { kind: 'horizontalRule' }
  | { kind: 'image'; image: ExportImage; alt: string };

export interface ExportScene {
  id: string;
  title: string | null;
  content: ExportBlock[];
}

export interface ExportChapter {
  id: string;
  title: string;
  scenes: ExportScene[];
}

export type ExportTocKind = 'book' | 'chapter' | 'scene';

export interface ExportTocEntry {
  id: string;
  kind: ExportTocKind;
  title: string;
  level: number;
  anchor: string;
}

export interface ExportDocument {
  id: string;
  title: string;
  author: string;
  cover: ExportImage | null;
  chapters: ExportChapter[];
}

export interface RenderedExport {
  buffer: Buffer;
  contentType: string;
  extension: SupportedExportFormat;
}
