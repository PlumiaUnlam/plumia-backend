import {
  ArrayMaxSize,
  IsArray,
  IsNotEmpty,
  IsString,
  MaxLength,
} from 'class-validator';

export class UpdateProjectEntityRecognitionDto {
  @IsArray()
  @ArrayMaxSize(200)
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  @MaxLength(200, { each: true })
  importantEntityNames!: string[];
}

export class ProjectEntityRecognitionSettingsResponseDto {
  importantEntityNames!: string[];
}
