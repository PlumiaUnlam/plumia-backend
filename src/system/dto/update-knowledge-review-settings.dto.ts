import { KnowledgeReviewMode } from '@prisma/client';
import { IsEnum, IsNumber, Max, Min } from 'class-validator';

export class UpdateKnowledgeReviewSettingsDto {
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
}
