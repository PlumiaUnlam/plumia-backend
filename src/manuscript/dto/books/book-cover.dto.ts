import { IsIn, IsNotEmpty, IsString, MaxLength } from 'class-validator';
import {
  BOOK_COVER_CONTENT_TYPES,
  type BookCoverContentType,
} from '../../services/book-cover.service';

export class CreateBookCoverUploadDto {
  @IsIn(BOOK_COVER_CONTENT_TYPES)
  contentType!: BookCoverContentType;
}

export class SetBookCoverDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  storageKey!: string;
}
