import { IsIn } from 'class-validator';
import { EXPORT_FORMATS, type SupportedExportFormat } from '../export.types';

export class CreateExportDto {
  @IsIn(EXPORT_FORMATS)
  format!: SupportedExportFormat;
}
