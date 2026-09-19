import type { ExportFormat, ExportStatus } from '@prisma/client';

export const EXPORT_FORMATS = ['PDF', 'DOCX', 'EPUB'] as const;
export type SupportedExportFormat = (typeof EXPORT_FORMATS)[number];

export type ExportJobRecord = {
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
};

export type ExportImage = {
  buffer: Buffer;
  mimeType: string;
  extension: string;
};

export type ExportInline =
  | {
      kind: 'text';
      text: string;
      bold: boolean;
      italic: boolean;
      href?: string;
    }
  | { kind: 'break' };

export type ExportTextBlock = {
  kind: 'paragraph' | 'heading' | 'blockquote' | 'codeBlock';
  inlines: ExportInline[];
  level?: number;
  textAlign?: string;
  lineHeight?: string;
  indentLeft?: number;
  indentRight?: number;
  firstLineIndent?: number;
};

export type ExportListBlock = {
  kind: 'bulletList' | 'orderedList';
  items: ExportBlock[][];
};

export type ExportBlock =
  | (ExportTextBlock & { kind: 'paragraph' })
  | (ExportTextBlock & { kind: 'heading' })
  | (ExportTextBlock & { kind: 'blockquote' })
  | (ExportTextBlock & { kind: 'codeBlock' })
  | (ExportListBlock & { kind: 'bulletList' })
  | (ExportListBlock & { kind: 'orderedList' })
  | { kind: 'sceneDivider' }
  | { kind: 'image'; image: ExportImage; alt: string };

export type ExportScene = {
  title: string | null;
  content: ExportBlock[];
};

export type ExportChapter = {
  title: string;
  scenes: ExportScene[];
};

export type ExportBook = {
  title: string;
  chapters: ExportChapter[];
};

export type ExportDocument = {
  title: string;
  books: ExportBook[];
};

export type RenderedExport = {
  buffer: Buffer;
  contentType: string;
  extension: SupportedExportFormat;
};
