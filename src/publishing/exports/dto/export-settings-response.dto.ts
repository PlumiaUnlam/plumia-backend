import type { ExportSettingsConfig } from '../export-settings.types';

export class ExportSettingsResponseDto {
  margins!: ExportSettingsConfig['margins'];
  header!: ExportSettingsConfig['header'];
  footer!: ExportSettingsConfig['footer'];

  static from(config: ExportSettingsConfig): ExportSettingsResponseDto {
    return {
      margins: config.margins,
      header: config.header,
      footer: config.footer,
    };
  }
}
