import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class UpdateSummaryDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(20000)
  content!: string;
}
