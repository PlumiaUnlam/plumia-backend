import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { RelationType } from '../domain/relation-type';

export class CreateRelationshipDto {
  @IsUUID()
  sourceEntityId!: string;

  @IsUUID()
  targetEntityId!: string;

  @IsEnum(RelationType)
  relationType!: RelationType;

  @IsInt()
  @Min(1)
  @Max(5)
  intensity!: number;

  @IsString()
  @IsOptional()
  @MaxLength(1000)
  description?: string;

  @IsString()
  @IsOptional()
  @IsNotEmpty()
  @IsUUID()
  validFromSceneId?: string;
}
