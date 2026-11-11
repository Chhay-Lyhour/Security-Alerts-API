import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  And,
  type FindOptionsWhere,
  LessThanOrEqual,
  MoreThanOrEqual,
  Repository,
} from 'typeorm';
import type { Paginated } from '../alerts/alerts.service.js';
import type { AuditEntry } from './audit-actions.js';
import type { QueryAuditDto } from './dto/query-audit.dto.js';
import { AuditLog } from './entities/audit-log.entity.js';

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(
    @InjectRepository(AuditLog) private readonly logs: Repository<AuditLog>,
  ) {}

  /**
   * Adds one row to the trail. Never throws: the request it describes has
   * already been answered, so a failure here is logged instead of surfacing.
   */
  async record(entry: AuditEntry): Promise<void> {
    try {
      await this.logs.save(this.logs.create(entry));
    } catch (error) {
      this.logger.error(
        `Could not write audit entry ${entry.action} by ${entry.userId ?? entry.actorRole}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  async findAll(query: QueryAuditDto): Promise<Paginated<AuditLog>> {
    const { page, limit } = query;
    const [data, total] = await this.logs.findAndCount({
      where: buildWhere(query),
      order: { createdAt: 'DESC', id: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });
    return { data, total, page, limit };
  }
}

function buildWhere(query: QueryAuditDto): FindOptionsWhere<AuditLog> {
  const where: FindOptionsWhere<AuditLog> = {};
  if (query.userId) where.userId = query.userId;
  if (query.action) where.action = query.action;
  if (query.outcome) where.outcome = query.outcome;
  if (query.targetType) where.targetType = query.targetType;
  if (query.targetId) where.targetId = query.targetId;

  const from = query.from ? new Date(query.from) : undefined;
  const to = query.to ? new Date(query.to) : undefined;
  if (from && to && from > to)
    throw new BadRequestException('from must be before to');
  if (from && to)
    where.createdAt = And(MoreThanOrEqual(from), LessThanOrEqual(to));
  else if (from) where.createdAt = MoreThanOrEqual(from);
  else if (to) where.createdAt = LessThanOrEqual(to);
  return where;
}
