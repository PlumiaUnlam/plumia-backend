import { Injectable } from '@nestjs/common';
import type { ExportRenderer } from './export-renderer.port';
import type {
  ExportDocument,
  RenderedExport,
  SupportedExportFormat,
} from './export.types';
import { DocxExportRenderer } from './renderers/docx-export.renderer';
import { EpubExportRenderer } from './renderers/epub-export.renderer';
import { PdfExportRenderer } from './renderers/pdf-export.renderer';

@Injectable()
export class ExportRendererService {
  private readonly renderers: ReadonlyMap<
    SupportedExportFormat,
    ExportRenderer
  >;

  constructor(
    docx: DocxExportRenderer,
    pdf: PdfExportRenderer,
    epub: EpubExportRenderer,
  ) {
    this.renderers = new Map<SupportedExportFormat, ExportRenderer>([
      [docx.format, docx],
      [pdf.format, pdf],
      [epub.format, epub],
    ]);
  }

  render(
    format: SupportedExportFormat,
    document: ExportDocument,
  ): Promise<RenderedExport> {
    const renderer = this.renderers.get(format);
    if (!renderer) {
      throw new Error(`Unsupported export format: ${format}`);
    }
    return renderer.render(document);
  }
}
