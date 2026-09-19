import type {
  ExportDocument,
  RenderedExport,
  SupportedExportFormat,
} from './export.types';

export const EXPORT_RENDERERS = Symbol('EXPORT_RENDERERS');

export interface ExportRenderer {
  readonly format: SupportedExportFormat;
  render(document: ExportDocument): Promise<RenderedExport>;
}
