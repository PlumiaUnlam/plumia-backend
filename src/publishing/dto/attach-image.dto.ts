import { IsString, IsUUID } from 'class-validator';

export class AttachImageDto {
  @IsUUID()
  entityId!: string;

  @IsString()
  storageKey!: string;

  @IsString()
  prompt!: string;

  @IsString()
  imageType!: string;
}
