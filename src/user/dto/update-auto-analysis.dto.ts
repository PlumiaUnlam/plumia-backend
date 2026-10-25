import { IsBoolean } from 'class-validator';

export class UpdateAutoAnalysisDto {
  @IsBoolean()
  enabled!: boolean;
}
