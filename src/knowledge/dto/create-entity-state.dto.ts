import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class CreateEntityStateDto {
  @IsString()
  @MaxLength(100)
  attributeKey!: string;

  @IsString()
  @MaxLength(1000)
  toValue!: string;

  @IsUUID()
  validFromSceneId!: string;

  @IsOptional()
  @IsUUID()
  validToSceneId?: string | null;
}
