import { IsString, IsUUID, MaxLength } from 'class-validator';

export class CreateMatrixNoteDto {
  @IsUUID()
  chapterId!: string;

  @IsString()
  @MaxLength(500)
  content!: string;
}
