import type { ExportSettingsConfig } from './export-settings.types';

export const DEFAULT_EXPORT_SETTINGS: ExportSettingsConfig = {
  margins: { topCm: 2.5, bottomCm: 2.5, leftCm: 2.5, rightCm: 2.5 },
  header: null,
  footer: null,
};

export function resolveTemplate(
  template: string,
  vars: Record<string, string>,
): string {
  return template.replace(
    /\{\{(\w+)\}\}/g,
    (_, key: string) => vars[key] ?? '',
  );
}
