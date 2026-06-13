import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsObject,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
} from 'class-validator';
import { WikiEntityType } from '../../domain/wiki-entity-type';

export class CreateEntityDto {
  @IsString()
  @MaxLength(200)
  canonicalName!: string;

  @IsEnum(WikiEntityType)
  type!: WikiEntityType;

  @IsString({ each: true })
  @IsArray()
  @ArrayMaxSize(50)
  @IsOptional()
  aliases?: string[];

  @IsString()
  @IsOptional()
  description?: string;

  @IsObject()
  @IsOptional()
  attributes?: Record<string, unknown>;

  @IsUrl()
  @MaxLength(500)
  @IsOptional()
  imageUrl?: string;
}
