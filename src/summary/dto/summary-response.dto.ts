import type { SummaryRecord } from '../ports/summary-repository.port';

export class SummaryResponseDto {
  id!: string;
  scopeType!: string;
  scopeId!: string;
  title!: string | null;
  content!: string;
  source!: string;
  isDirty!: boolean;
  provider!: string | null;
  model!: string | null;
  tokenCount!: number | null;
  createdAt!: Date;
  updatedAt!: Date;

  static from(summary: SummaryRecord): SummaryResponseDto {
    return {
      id: summary.id,
      scopeType: summary.scopeType,
      scopeId: summary.scopeId,
      title: summary.title,
      content: summary.content,
      source: summary.source,
      isDirty: summary.isDirty,
      provider: summary.provider,
      model: summary.model,
      tokenCount: summary.tokenCount,
      createdAt: summary.createdAt,
      updatedAt: summary.updatedAt,
    };
  }
}
