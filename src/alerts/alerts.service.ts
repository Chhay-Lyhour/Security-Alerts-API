import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import {
  And,
  FindOptionsWhere,
  LessThanOrEqual,
  MoreThanOrEqual,
  Repository,
} from 'typeorm';
import type { Source } from '../sources/entities/source.entity.js';
import type { CreateAlertDto } from './dto/create-alert.dto.js';
import type { QueryAlertsDto } from './dto/query-alerts.dto.js';
import { AlertStatus } from './entities/alert-status.enum.js';
import { Alert } from './entities/alert.entity.js';
import {
  ALERT_CREATED,
  AlertCreatedEvent,
} from './events/alert-created.event.js';
import {
  ALERT_STATUS_CHANGED,
  AlertStatusChangedEvent,
} from './events/alert-status-changed.event.js';

export type Paginated<T> = {
  data: T[];
  total: number;
  page: number;
  limit: number;
};

const ALLOWED_TRANSITIONS: Record<AlertStatus, AlertStatus[]> = {
  [AlertStatus.OPEN]: [AlertStatus.ACKNOWLEDGED, AlertStatus.RESOLVED],
  [AlertStatus.ACKNOWLEDGED]: [AlertStatus.RESOLVED],
  [AlertStatus.RESOLVED]: [],
};

@Injectable()
export class AlertsService {
  constructor(
    @InjectRepository(Alert) private readonly alerts: Repository<Alert>,
    private readonly events: EventEmitter2,
  ) {}

  async ingest(source: Source, dto: CreateAlertDto): Promise<Alert> {
    const alert = await this.alerts.save(
      this.alerts.create({
        title: dto.title,
        severity: dto.severity,
        type: dto.type,
        ipAddress: dto.ipAddress ?? null,
        payload: dto.payload ?? {},
        status: AlertStatus.OPEN,
        sourceId: source.id,
      }),
    );
    this.events.emit(
      ALERT_CREATED,
      new AlertCreatedEvent(
        alert.id,
        alert.type,
        alert.severity,
        alert.ipAddress,
      ),
    );
    return alert;
  }

  async findAll(query: QueryAlertsDto): Promise<Paginated<Alert>> {
    const { page, limit } = query;
    const [data, total] = await this.alerts.findAndCount({
      where: buildWhere(query),
      order: { createdAt: 'DESC', id: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });
    return { data, total, page, limit };
  }

  async findOne(id: string): Promise<Alert> {
    const alert = await this.alerts.findOne({ where: { id } });
    if (!alert) throw new NotFoundException(`Alert ${id} not found`);
    return alert;
  }

  async updateStatus(
    id: string,
    to: AlertStatus,
    userId: string,
  ): Promise<Alert> {
    const alert = await this.findOne(id);
    const from = alert.status;
    if (!ALLOWED_TRANSITIONS[from].includes(to)) {
      throw new ConflictException(`Cannot change status from ${from} to ${to}`);
    }

    const result = await this.alerts.update(
      { id, status: from },
      { status: to },
    );
    if (!result.affected) {
      throw new ConflictException(
        'Alert status changed meanwhile, reload and retry',
      );
    }

    this.events.emit(
      ALERT_STATUS_CHANGED,
      new AlertStatusChangedEvent(id, userId, from, to),
    );
    alert.status = to;
    return alert;
  }

  async remove(id: string): Promise<void> {
    const result = await this.alerts.delete({ id });
    if (!result.affected) throw new NotFoundException(`Alert ${id} not found`);
  }
}

function buildWhere(query: QueryAlertsDto): FindOptionsWhere<Alert> {
  const where: FindOptionsWhere<Alert> = {};
  if (query.severity) where.severity = query.severity;
  if (query.status) where.status = query.status;
  if (query.type) where.type = query.type;
  if (query.sourceId) where.sourceId = query.sourceId;
  if (query.ipAddress) where.ipAddress = query.ipAddress;

  const from = query.from ? new Date(query.from) : undefined;
  const to = query.to ? new Date(query.to) : undefined;
  if (from && to && from > to) {
    throw new BadRequestException('from must be before to');
  }
  if (from && to)
    where.createdAt = And(MoreThanOrEqual(from), LessThanOrEqual(to));
  else if (from) where.createdAt = MoreThanOrEqual(from);
  else if (to) where.createdAt = LessThanOrEqual(to);
  return where;
}
