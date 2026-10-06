import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class UpdateEntityStateDto {
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  toValue?: string;

  @IsOptional()
  @IsUUID()
  validToSceneId?: string | null;
}
