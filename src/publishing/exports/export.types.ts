import type { ExportFormat, ExportStatus } from '@prisma/client';

export const EXPORT_FORMATS = ['PDF', 'DOCX', 'EPUB'] as const;
export type SupportedExportFormat = (typeof EXPORT_FORMATS)[number];

export interface ExportJobRecord {
  id: string;
  projectId: string;
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

export interface ExportTocEntry {
  id: string;
  kind: 'project' | 'book' | 'chapter' | 'scene';
  title: string;
  level: number;
  anchor: string;
}

export type ExportInline =
  | {
      kind: 'text';
      text: string;
      bold: boolean;
      italic: boolean;
      href?: string;
    }
  | { kind: 'break' };

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
  | { kind: 'sceneDivider' }
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

export interface ExportBook {
  id: string;
  title: string;
  chapters: ExportChapter[];
}

export interface ExportDocument {
  id: string;
  title: string;
  books: ExportBook[];
  toc: ExportTocEntry[];
}

export interface RenderedExport {
  buffer: Buffer;
  contentType: string;
  extension: SupportedExportFormat;
}
