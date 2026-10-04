import type {
  ExportDocument,
  RenderedExport,
  SupportedExportFormat,
} from './export.types';
import type { ExportSettingsConfig } from './export-settings.types';

export const EXPORT_RENDERERS = Symbol('EXPORT_RENDERERS');

export interface ExportRenderer {
  readonly format: SupportedExportFormat;
  render(
    document: ExportDocument,
    settings: ExportSettingsConfig,
  ): Promise<RenderedExport>;
}
