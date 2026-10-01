import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import type { ExportAlignment } from '../export-settings.types';

const ALIGNMENTS: readonly ExportAlignment[] = ['left', 'center', 'right'];

class PageNumberDto {
  @IsBoolean()
  enabled!: boolean;

  @IsString()
  @MaxLength(80)
  format!: string;
}

class HeaderFooterDto {
  @IsOptional()
  @IsString()
  @MaxLength(300)
  text?: string | null;

  @IsIn(ALIGNMENTS)
  alignment!: ExportAlignment;

  @IsObject()
  @ValidateNested()
  @Type(() => PageNumberDto)
  pageNumber!: PageNumberDto;
}

class MarginsDto {
  @IsNumber()
  @Min(0)
  @Max(10)
  topCm!: number;

  @IsNumber()
  @Min(0)
  @Max(10)
  bottomCm!: number;

  @IsNumber()
  @Min(0)
  @Max(10)
  leftCm!: number;

  @IsNumber()
  @Min(0)
  @Max(10)
  rightCm!: number;
}

export class UpdateExportSettingsDto {
  @IsObject()
  @ValidateNested()
  @Type(() => MarginsDto)
  margins!: MarginsDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => HeaderFooterDto)
  header?: HeaderFooterDto | null;

  @IsOptional()
  @ValidateNested()
  @Type(() => HeaderFooterDto)
  footer?: HeaderFooterDto | null;
}
