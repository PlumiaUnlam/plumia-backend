import { IsString, IsUUID } from 'class-validator';

export class SetPrimaryImageDto {
  @IsString()
  @IsUUID()
  imageId!: string;
}
