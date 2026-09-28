import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class SharedStorageUrlDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  storageKey!: string;
}
