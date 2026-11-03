import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class UpdateProviderApiKeyDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  apiKey!: string;
}
