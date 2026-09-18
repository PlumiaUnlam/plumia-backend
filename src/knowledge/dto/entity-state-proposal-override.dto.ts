import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class EntityStateProposalOverrideDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  attributeKey?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  toValue?: string;

  @IsOptional()
  @IsUUID()
  validFromSceneId?: string;

  @IsOptional()
  @IsUUID()
  validToSceneId?: string | null;
}
