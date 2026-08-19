import {
  IsArray,
  IsEnum,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { EntityType } from '../domain/entity-type';

export class EntityProposalOverrideDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  @IsOptional()
  canonicalName?: string;

  @IsEnum(EntityType)
  @IsOptional()
  type?: EntityType;

  @IsString()
  @IsOptional()
  description?: string | null;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  aliases?: string[];

  @IsObject()
  @IsOptional()
  attributes?: Record<string, unknown>;

  @IsString()
  @MaxLength(500)
  @IsOptional()
  imageUrl?: string | null;
}
