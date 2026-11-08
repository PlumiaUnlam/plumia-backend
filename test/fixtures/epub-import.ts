import JSZip from 'jszip';

export async function createEpub(
  documents: Array<{ id: string; body: string }>,
  files: Record<string, Buffer | string> = {},
  navigation?: { href: string; body: string },
): Promise<Buffer> {
  const zip = new JSZip();
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
  zip.file(
    'META-INF/container.xml',
    '<container><rootfiles><rootfile full-path="OEBPS/book.opf" /></rootfiles></container>',
  );
  const manifest = documents
    .map(
      ({ id }) =>
        `<item id="${id}" href="Text/${id}.xhtml" media-type="application/xhtml+xml" />`,
    )
    .join('');
  const spine = documents.map(({ id }) => `<itemref idref="${id}" />`).join('');
  const navigationItem = navigation
    ? `<item id="navigation" href="${navigation.href}" media-type="application/xhtml+xml" properties="nav" />`
    : '';
  zip.file(
    'OEBPS/book.opf',
    `<package><metadata><title>Libro de prueba</title></metadata><manifest>${navigationItem}${manifest}</manifest><spine>${spine}</spine></package>`,
  );
  for (const { id, body } of documents) {
    zip.file(
      `OEBPS/Text/${id}.xhtml`,
      `<html><head><title>Libro de prueba</title></head><body>${body}</body></html>`,
    );
  }
  for (const [path, content] of Object.entries(files)) {
    zip.file(path, content);
  }
  if (navigation) {
    zip.file(`OEBPS/${navigation.href}`, navigation.body);
  }
  return zip.generateAsync({ type: 'nodebuffer' });
}

export function textFrom(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap(textFrom);
  }
  if (!value || typeof value !== 'object') {
    return [];
  }

  const record = value as Record<string, unknown>;
  return [
    ...(typeof record['text'] === 'string' ? [record['text']] : []),
    ...Object.entries(record)
      .filter(([key]) => key !== 'text')
      .flatMap(([, child]) => textFrom(child)),
  ];
}

export function nodesOfType(
  value: unknown,
  type: string,
): Record<string, unknown>[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => nodesOfType(item, type));
  }
  if (!value || typeof value !== 'object') {
    return [];
  }

  const record = value as Record<string, unknown>;
  return [
    ...(record['type'] === type ? [record] : []),
    ...Object.values(record).flatMap((child) => nodesOfType(child, type)),
  ];
}
