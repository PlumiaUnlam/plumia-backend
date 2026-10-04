import { IsDateString, IsInt, IsOptional, Max, Min } from 'class-validator';

export class UpsertWritingGoalDto {
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  targetWords!: number;

  @IsDateString()
  @IsOptional()
  deadline?: string;
}
