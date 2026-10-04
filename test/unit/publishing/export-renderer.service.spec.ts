import type { ExportRenderer } from '../../../src/publishing/exports/export-renderer.port';
import { ExportRendererService } from '../../../src/publishing/exports/export-renderer.service';
import type {
  ExportDocument,
  RenderedExport,
  SupportedExportFormat,
} from '../../../src/publishing/exports/export.types';
import { DEFAULT_EXPORT_SETTINGS } from '../../../src/publishing/exports/export-settings.defaults';
import type { ExportSettingsConfig } from '../../../src/publishing/exports/export-settings.types';
import type { DocxExportRenderer } from '../../../src/publishing/exports/renderers/docx-export.renderer';
import type { EpubExportRenderer } from '../../../src/publishing/exports/renderers/epub-export.renderer';
import type { PdfExportRenderer } from '../../../src/publishing/exports/renderers/pdf-export.renderer';

describe('ExportRendererService', () => {
  const document: ExportDocument = {
    id: 'book-id',
    title: 'La obra',
    chapters: [],
  };
  const settings: ExportSettingsConfig = DEFAULT_EXPORT_SETTINGS;
  const result: RenderedExport = {
    buffer: Buffer.from('export'),
    contentType: 'application/octet-stream',
    extension: 'DOCX',
  };
  const createRenderer = (format: SupportedExportFormat): ExportRenderer => ({
    format,
    render: jest.fn().mockResolvedValue({ ...result, extension: format }),
  });
  const docx = createRenderer('DOCX');
  const pdf = createRenderer('PDF');
  const epub = createRenderer('EPUB');
  const service = new ExportRendererService(
    docx as DocxExportRenderer,
    pdf as PdfExportRenderer,
    epub as EpubExportRenderer,
  );

  it.each([
    ['DOCX', docx],
    ['PDF', pdf],
    ['EPUB', epub],
  ] as const)(
    'delegates %s rendering to its renderer',
    async (format, renderer) => {
      await expect(service.render(format, document, settings)).resolves.toEqual(
        { ...result, extension: format },
      );
      expect(renderer.render).toHaveBeenCalledWith(document, settings);
    },
  );

  it('reports unsupported formats', () => {
    expect(() =>
      service.render('TXT' as SupportedExportFormat, document, settings),
    ).toThrow('Unsupported export format: TXT');
  });
});
