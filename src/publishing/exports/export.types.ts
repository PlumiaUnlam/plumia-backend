import type { ExportFormat, ExportStatus } from '@prisma/client';

export const EXPORT_FORMATS = ['PDF', 'DOCX', 'EPUB'] as const;
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

export type NoteType = 'FOOTNOTE' | 'ENDNOTE';

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
      kind: 'noteReference';
      noteId: string;
      noteType: NoteType;
      number: number;
    };

export interface ExportNote {
  id: string;
  noteType: NoteType;
  content: ExportBlock[];
  number: number;
}

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
  title: string | null;
  content: ExportBlock[];
  notes: ExportNote[];
}

export interface ExportChapter {
  title: string;
  scenes: ExportScene[];
}

export interface ExportDocument {
  title: string;
  chapters: ExportChapter[];
}

export interface RenderedExport {
  buffer: Buffer;
  contentType: string;
  extension: SupportedExportFormat;
}

/** Flattens the notes referenced across a chapter's scenes, in document order. */
function chapterNotes(chapter: ExportChapter): ExportNote[] {
  return chapter.scenes.flatMap((scene) => scene.notes);
}

/** Flattens every note referenced across the whole book, in document order. */
export function bookNotes(document: ExportDocument): ExportNote[] {
  return document.chapters.flatMap((chapter) => chapterNotes(chapter));
}
