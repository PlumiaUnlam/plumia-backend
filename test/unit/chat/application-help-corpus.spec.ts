import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isSafeChatRoute } from '../../../src/chat/domain/chat-navigation';

interface HelpEntry {
  id: string;
  route: string;
  text: string;
}

const entries = readFileSync(
  join(__dirname, '../../../src/chat/data/application-help.jsonl'),
  'utf8',
)
  .trim()
  .split('\n')
  .map((line) => JSON.parse(line) as HelpEntry);

describe('writer-facing application help', () => {
  it('keeps implementation details and route templates out of visible instructions', () => {
    const technicalText =
      /\b(?:backend|frontend|endpoint|SQL|JSON|RAG|embedding)\b|`\/(?:projects|dashboard|login|register|shared)/i;
    expect(
      entries
        .filter((entry) => technicalText.test(entry.text))
        .map((entry) => entry.id),
    ).toEqual([]);
  });

  it('offers usable routes after substituting the project, without inventing personal invitation links', () => {
    for (const entry of entries) {
      const route = entry.route.replaceAll('{projectId}', 'test-project');
      expect(isSafeChatRoute(route)).toBe(!route.includes('{slug}'));
    }
  });

  it('documents EPUB import and automatic image conversion without obsolete export errors', () => {
    expect(
      entries.find((entry) => entry.id === 'proyectos.importar-epub')?.route,
    ).toBe('/dashboard');
    expect(
      entries.find((entry) => entry.id === 'exportar.epub.imagenes')?.text,
    ).toContain('convierte automáticamente');
    expect(
      entries.some((entry) =>
        entry.text.includes('no hay importación de archivos'),
      ),
    ).toBe(false);
    expect(
      entries.some((entry) => entry.text.includes('WebP o AVIF hacen fallar')),
    ).toBe(false);
  });
});
