import { IsString } from 'class-validator';

export class AttachImageDto {
  @IsString()
  entityId!: string;

  @IsString()
  storageKey!: string;

  @IsString()
  prompt!: string;

  @IsString()
  imageType!: string;
}
