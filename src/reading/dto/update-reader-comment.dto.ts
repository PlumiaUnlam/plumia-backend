import { ReaderCommentStatus } from '@prisma/client';
import { IsEnum } from 'class-validator';

export class UpdateReaderCommentDto {
  @IsEnum(ReaderCommentStatus)
  status!: ReaderCommentStatus;
}
