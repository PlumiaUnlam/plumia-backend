import type { SummaryJobRecord } from '../ports/summary-repository.port';

export class SummaryJobResponseDto {
  id!: string;
  scopeType!: string;
  scopeId!: string;
  status!: string;
  progress!: number;
  errorMessage!: string | null;
  createdAt!: Date;
  completedAt!: Date | null;

  static from(job: SummaryJobRecord): SummaryJobResponseDto {
    return {
      id: job.id,
      scopeType: job.scopeType,
      scopeId: job.scopeId,
      status: job.status,
      progress: job.progress,
      errorMessage: job.errorMessage,
      createdAt: job.createdAt,
      completedAt: job.completedAt,
    };
  }
}
