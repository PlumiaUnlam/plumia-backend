import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateReaderCommentDto {
  @IsUUID()
  snapshotSceneId!: string;

  @IsInt()
  @Min(0)
  anchorFrom!: number;

  @IsInt()
  @Min(1)
  anchorTo!: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(5_000)
  selectedText!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(10_000)
  body!: string;

  @IsString()
  @MaxLength(200)
  @IsOptional()
  prefix?: string;

  @IsString()
  @MaxLength(200)
  @IsOptional()
  suffix?: string;
}
