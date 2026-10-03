export type ExportAlignment = 'left' | 'center' | 'right';

export interface ExportPageNumberConfig {
  enabled: boolean;
  format: string;
}

export interface ExportHeaderFooterConfig {
  text: string | null;
  alignment: ExportAlignment;
  pageNumber: ExportPageNumberConfig;
}

export interface ExportMarginsConfig {
  topCm: number;
  bottomCm: number;
  leftCm: number;
  rightCm: number;
}

export interface ExportSettingsConfig {
  margins: ExportMarginsConfig;
  header: ExportHeaderFooterConfig | null;
  footer: ExportHeaderFooterConfig | null;
}
