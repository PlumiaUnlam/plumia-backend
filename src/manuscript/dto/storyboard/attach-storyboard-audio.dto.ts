import {
  IsInt,
  IsNotEmpty,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class AttachStoryboardAudioDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  audioStorageKey!: string;

  @IsInt()
  @Min(1)
  @Max(3600)
  audioDurationSecs!: number;
}
