import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { WikiEntityType } from '../../domain/wiki-entity-type';

export class ListEntitiesQueryDto {
  @IsEnum(WikiEntityType)
  @IsOptional()
  type?: WikiEntityType;

  @IsString()
  @MaxLength(200)
  @IsOptional()
  search?: string;
}
