export interface ExportIndentationValues {
  indentLeft?: number | undefined;
  indentRight?: number | undefined;
  firstLineIndent?: number | undefined;
}

export interface NormalizedExportIndentation {
  indentLeft: number;
  indentRight: number;
  firstLineIndent: number;
}

const MINIMUM_CONTENT_WIDTH_CM = 1;

function nonNegativeFinite(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, value)
    : 0;
}

export function normalizeExportIndentation(
  values: ExportIndentationValues,
  availableWidthCm = 16.5,
): NormalizedExportIndentation {
  const width = Math.max(MINIMUM_CONTENT_WIDTH_CM, availableWidthCm);
  const maxMargins = Math.max(0, width - MINIMUM_CONTENT_WIDTH_CM);
  const indentLeft = Math.min(nonNegativeFinite(values.indentLeft), maxMargins);
  const indentRight = Math.min(
    nonNegativeFinite(values.indentRight),
    Math.max(0, maxMargins - indentLeft),
  );
  const firstLineIndent = Math.min(
    nonNegativeFinite(values.firstLineIndent),
    Math.max(0, width - indentLeft - indentRight - MINIMUM_CONTENT_WIDTH_CM),
  );

  return { indentLeft, indentRight, firstLineIndent };
}
