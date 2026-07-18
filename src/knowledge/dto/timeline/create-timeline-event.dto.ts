import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { TimelineImpact } from '../../domain/timeline-impact';

export class CreateTimelineEventDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  date?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  temporalLabel?: string | null;

  @IsOptional()
  @IsEnum(TimelineImpact)
  impact?: TimelineImpact;

  @IsOptional()
  @IsUUID()
  storyboardArcId?: string | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsUUID('4', { each: true })
  entityIds?: string[];

  @IsOptional()
  @IsUUID()
  beforeEventId?: string;

  @IsOptional()
  @IsUUID()
  afterEventId?: string;
}
