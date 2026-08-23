import { IsOptional, IsString, MaxLength } from 'class-validator';

export class ListChatThreadsQueryDto {
  @IsOptional()
  @IsString()
  page?: string;

  @IsOptional()
  @IsString()
  pageSize?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
}
