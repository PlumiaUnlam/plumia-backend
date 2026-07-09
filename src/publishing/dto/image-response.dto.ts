export class ImageResponseDto {
  id!: string;
  entityId!: string;
  prompt!: string;
  imageUrl!: string;
  imageType!: string;
  isPrimary!: boolean;
  createdAt!: Date;
}
