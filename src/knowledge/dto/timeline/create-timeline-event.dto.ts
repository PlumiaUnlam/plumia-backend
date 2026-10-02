import {
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { TimelineEventFieldsDto } from './timeline-event-fields.dto';

export class CreateTimelineEventDto extends TimelineEventFieldsDto {
  declare description?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title!: string;

  @IsOptional()
  @IsUUID()
  beforeEventId?: string;

  @IsOptional()
  @IsUUID()
  afterEventId?: string;
}
