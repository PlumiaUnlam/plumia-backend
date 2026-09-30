import type { ExportBook, ExportTocEntry } from './export.types';

export function exportAnchor(kind: ExportTocEntry['kind'], id: string): string {
  return `export_${kind}_${id.replace(/[^A-Za-z0-9_]/g, '_')}`;
}

export function buildExportToc(
  projectId: string,
  title: string,
  books: ExportBook[],
): ExportTocEntry[] {
  const entries: ExportTocEntry[] = [
    {
      id: projectId,
      kind: 'project',
      title,
      level: 0,
      anchor: exportAnchor('project', projectId),
    },
  ];

  for (const book of books) {
    entries.push({
      id: book.id,
      kind: 'book',
      title: book.title,
      level: 1,
      anchor: exportAnchor('book', book.id),
    });

    for (const chapter of book.chapters) {
      entries.push({
        id: chapter.id,
        kind: 'chapter',
        title: chapter.title,
        level: 2,
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
          level: 3,
          anchor: exportAnchor('scene', scene.id),
        });
      }
    }
  }

  return entries;
}
