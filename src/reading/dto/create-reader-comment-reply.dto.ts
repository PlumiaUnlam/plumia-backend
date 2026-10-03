import { IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class CreateReaderCommentReplyDto {
  @IsString()
  @MinLength(1)
  @MaxLength(5000)
  @Matches(/\S/)
  body!: string;
}
