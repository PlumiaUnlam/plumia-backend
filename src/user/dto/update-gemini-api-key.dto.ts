import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class UpdateGeminiApiKeyDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  apiKey!: string;
}
