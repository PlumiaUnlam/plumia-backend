import JSZip from 'jszip';
import type { ExportImage } from '../../../src/publishing/exports/export.types';

export const imageBuffer = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

export const source = {
  id: 'book-id',
  title: 'La obra',
  chapters: [
    {
      id: 'chapter-id',
      title: 'Capítulo I',
      scenes: [
        {
          id: 'scene-id',
          title: 'La llegada',
          content: {
            type: 'doc',
            content: [
              {
                type: 'heading',
                attrs: { level: 2 },
                content: [{ type: 'text', text: 'Una noche' }],
              },
              {
                type: 'paragraph',
                content: [
                  {
                    type: 'text',
                    text: 'El tren llegó.',
                    marks: [{ type: 'bold' }],
                  },
                ],
              },
              {
                type: 'image',
                attrs: {
                  storageKey: 'scenes/scene/image.png',
                  alt: 'Estación',
                },
              },
            ],
          },
        },
      ],
    },
  ],
};

export const imageLayoutSource = {
  id: 'book-id',
  title: 'La obra',
  chapters: [
    {
      id: 'chapter-id',
      title: 'Capítulo I',
      scenes: [
        {
          id: 'scene-id',
          title: 'La llegada',
          content: {
            type: 'doc',
            content: [
              {
                type: 'image',
                attrs: {
                  storageKey: 'scenes/scene-id/left.webp',
                  alt: 'Imagen izquierda',
                  width: 240,
                  textFlow: 'text-right',
                },
              },
              {
                type: 'image',
                attrs: {
                  storageKey: 'scenes/scene-id/right.png',
                  alt: 'Imagen derecha',
                  width: '180',
                  textFlow: 'text-left',
                },
              },
              {
                type: 'image',
                attrs: {
                  storageKey: 'scenes/scene-id/full.png',
                  alt: 'Imagen de renglón completo',
                  width: 320,
                  textFlow: 'break',
                },
              },
            ],
          },
        },
      ],
    },
  ],
};

export const multiSceneSource = {
  id: 'book-id',
  title: 'La obra',
  chapters: [
    {
      id: 'chapter-1',
      title: 'Capítulo I',
      scenes: [
        {
          id: 'scene-1',
          title: 'Escena 1',
          content: {
            type: 'doc',
            content: [
              {
                type: 'paragraph',
                content: [{ type: 'text', text: 'Contenido de la escena 1.' }],
              },
            ],
          },
        },
        {
          id: 'scene-2',
          title: 'Escena 2',
          content: {
            type: 'doc',
            content: [
              {
                type: 'paragraph',
                content: [{ type: 'text', text: 'Contenido de la escena 2.' }],
              },
            ],
          },
        },
      ],
    },
  ],
};

export const multiChapterSource = {
  id: 'book-id',
  title: 'La obra',
  chapters: [
    {
      id: 'chapter-1',
      title: 'Capítulo I',
      scenes: [
        {
          id: 'chapter1-scene',
          title: 'Escena única',
          content: {
            type: 'doc',
            content: [
              {
                type: 'paragraph',
                content: [{ type: 'text', text: 'Contenido del capítulo 1.' }],
              },
            ],
          },
        },
      ],
    },
    {
      id: 'chapter-2',
      title: 'Capítulo II',
      scenes: [
        {
          id: 'chapter2-scene',
          title: 'Escena única',
          content: {
            type: 'doc',
            content: [
              {
                type: 'paragraph',
                content: [{ type: 'text', text: 'Contenido del capítulo 2.' }],
              },
            ],
          },
        },
      ],
    },
  ],
};

export const pngImage = (): Promise<ExportImage> =>
  Promise.resolve({
    buffer: imageBuffer,
    mimeType: 'image/png',
    extension: 'png',
  });

export async function epubXhtmlFiles(buffer: Buffer): Promise<string[]> {
  const zip = await JSZip.loadAsync(buffer);
  const entries = Object.keys(zip.files)
    .filter(
      (name) =>
        name.endsWith('.xhtml') && name.split('/').pop() !== 'toc.xhtml',
    )
    .sort();
  return Promise.all(entries.map((name) => zip.files[name]!.async('string')));
}

export function epubBody(html: string): string {
  return html.match(/<body>([\s\S]*)<\/body>/)?.[1] ?? html;
}
