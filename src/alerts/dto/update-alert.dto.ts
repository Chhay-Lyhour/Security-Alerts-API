import { PartialType } from '@nestjs/mapped-types';
import { CreateAlertDto } from './create-alert.dto.js';

export class UpdateAlertDto extends PartialType(CreateAlertDto) {}
