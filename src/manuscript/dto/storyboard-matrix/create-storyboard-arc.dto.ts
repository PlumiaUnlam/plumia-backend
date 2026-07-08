import { IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class CreateStoryboardArcDto {
  @IsString()
  @MaxLength(200)
  title!: string;

  @IsIn(['custom', 'entity', 'relationship'])
  sourceType!: 'custom' | 'entity' | 'relationship';

  @IsOptional()
  @IsString()
  @MaxLength(80)
  customType?: string;

  @IsOptional()
  @IsUUID()
  entityId?: string;

  @IsOptional()
  @IsUUID()
  relationshipId?: string;
}
