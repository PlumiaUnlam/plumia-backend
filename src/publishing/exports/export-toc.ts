import type {
  ExportDocument,
  ExportTocEntry,
  ExportTocKind,
} from './export.types';

export function exportAnchor(kind: ExportTocKind, id: string): string {
  return `export_${kind}_${id.replace(/\W/g, '_')}`;
}

/**
 * The export scope is a book. The book is therefore the root of the visible
 * index, followed by its canonical chapter and titled-scene hierarchy.
 */
export function buildExportToc(document: ExportDocument): ExportTocEntry[] {
  const entries: ExportTocEntry[] = [
    {
      id: document.id,
      kind: 'book',
      title: document.title,
      level: 0,
      anchor: exportAnchor('book', document.id),
    },
  ];

  for (const chapter of document.chapters) {
    entries.push({
      id: chapter.id,
      kind: 'chapter',
      title: chapter.title,
      level: 1,
      anchor: exportAnchor('chapter', chapter.id),
    });

    for (const scene of chapter.scenes) {
      if (!scene.title) {
        continue;
      }

      entries.push({
        id: scene.id,
        kind: 'scene',
        title: scene.title,
        level: 2,
        anchor: exportAnchor('scene', scene.id),
      });
    }
  }

  return entries;
}
