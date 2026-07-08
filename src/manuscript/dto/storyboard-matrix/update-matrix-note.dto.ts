import { IsString, MaxLength } from 'class-validator';

export class UpdateMatrixNoteDto {
  @IsString()
  @MaxLength(500)
  content!: string;
}
