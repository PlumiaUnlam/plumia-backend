import { Type } from 'class-transformer';
import { IsNumber, IsObject, Max, Min, ValidateNested } from 'class-validator';

class EntityRecognitionThresholdsDto {
  @IsNumber()
  @Min(0)
  @Max(1)
  CHARACTER!: number;

  @IsNumber()
  @Min(0)
  @Max(1)
  LOCATION!: number;

  @IsNumber()
  @Min(0)
  @Max(1)
  OBJECT!: number;

  @IsNumber()
  @Min(0)
  @Max(1)
  ORGANIZATION!: number;

  @IsNumber()
  @Min(0)
  @Max(1)
  EVENT!: number;

  @IsNumber()
  @Min(0)
  @Max(1)
  CONCEPT!: number;
}

export class UpdateEntityRecognitionDto {
  @IsObject()
  @ValidateNested()
  @Type(() => EntityRecognitionThresholdsDto)
  thresholds!: EntityRecognitionThresholdsDto;
}
