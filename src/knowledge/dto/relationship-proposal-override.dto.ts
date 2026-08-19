import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { RelationType } from '../domain/relation-type';

export class RelationshipProposalOverrideDto {
  @IsUUID()
  @IsOptional()
  sourceEntityId?: string;

  @IsUUID()
  @IsOptional()
  targetEntityId?: string;

  @IsEnum(RelationType)
  @IsOptional()
  relationType?: RelationType;

  @IsInt()
  @Min(1)
  @Max(5)
  @IsOptional()
  intensity?: number;

  @IsString()
  @IsOptional()
  @MaxLength(1000)
  description?: string | null;
}
