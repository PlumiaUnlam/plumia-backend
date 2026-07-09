import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { EntityType } from '../domain/entity-type';

export class UpdateEntityDto {
  @IsString()
  @MaxLength(200)
  @IsOptional()
  canonicalName?: string;

  @IsEnum(EntityType)
  @IsOptional()
  type?: EntityType;

  @IsString()
  @IsOptional()
  description?: string;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  aliases?: string[];

  @IsObject()
  @IsOptional()
  attributes?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  imageUrl?: string | null;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
