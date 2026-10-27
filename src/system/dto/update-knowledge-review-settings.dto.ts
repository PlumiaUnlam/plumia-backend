import { CrossChunkAuditMode, KnowledgeReviewMode } from '@prisma/client';
import { IsBoolean, IsEnum, IsNumber, Max, Min } from 'class-validator';

export class UpdateKnowledgeReviewSettingsDto {
  @IsBoolean()
  stateTrackingEnabled!: boolean;

  @IsEnum(KnowledgeReviewMode)
  stateReviewMode!: KnowledgeReviewMode;

  @IsNumber()
  @Min(0)
  @Max(1)
  stateConfidenceThreshold!: number;

  @IsEnum(KnowledgeReviewMode)
  relationshipReviewMode!: KnowledgeReviewMode;

  @IsNumber()
  @Min(0)
  @Max(1)
  relationshipConfidenceThreshold!: number;

  @IsEnum(CrossChunkAuditMode)
  crossChunkAuditMode!: CrossChunkAuditMode;
}
