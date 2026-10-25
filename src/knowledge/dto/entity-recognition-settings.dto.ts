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

  @IsArray()
  @ArrayMaxSize(200)
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  @MaxLength(200, { each: true })
  ignoredEntityNames!: string[];
}

export class ProjectEntityRecognitionSettingsResponseDto {
  importantEntityNames!: string[];
  ignoredEntityNames!: string[];
  rejectedEntities!: {
    id: string;
    entityId: string | null;
    name: string;
    aliases: string[];
    type: string | null;
    sceneTitle: string | null;
    createdAt: Date;
  }[];
}
