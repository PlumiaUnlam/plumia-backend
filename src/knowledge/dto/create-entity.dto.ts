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

export class CreateEntityDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  canonicalName!: string;

  @IsEnum(EntityType)
  type!: EntityType;

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

  @IsString()
  @MaxLength(500)
  @IsOptional()
  imageUrl?: string;
}
