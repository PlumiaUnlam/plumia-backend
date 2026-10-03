import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class AcceptShareDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(256)
  token!: string;
}
