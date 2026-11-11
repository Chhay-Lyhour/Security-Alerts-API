import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import type { EventEmitter2 } from '@nestjs/event-emitter';
import type { Repository } from 'typeorm';
import type { Source } from '../sources/entities/source.entity.js';
import { AlertsService } from './alerts.service.js';
import { QueryAlertsDto } from './dto/query-alerts.dto.js';
import { AlertSeverity } from './entities/alert-severity.enum.js';
import { AlertStatus } from './entities/alert-status.enum.js';
import type { Alert } from './entities/alert.entity.js';
import {
  ALERT_CREATED,
  AlertCreatedEvent,
} from './events/alert-created.event.js';
import { ALERT_STATUS_CHANGED } from './events/alert-status-changed.event.js';

const source = { id: 'src-1', name: 'web-1' } as Source;

const storedAlert = (overrides: Partial<Alert> = {}): Alert => ({
  id: 'alert-1',
  title: 'Failed login',
  severity: AlertSeverity.MEDIUM,
  type: 'failed_login',
  ipAddress: '10.0.0.1',
  payload: {},
  status: AlertStatus.OPEN,
  sourceId: source.id,
  createdAt: new Date('2026-11-11T00:00:00Z'),
  ...overrides,
});

const query = (overrides: Partial<QueryAlertsDto> = {}) =>
  Object.assign(new QueryAlertsDto(), overrides);

describe('AlertsService', () => {
  let repo: Record<
    'create' | 'save' | 'findAndCount' | 'findOne' | 'update' | 'delete',
    ReturnType<typeof vi.fn>
  >;
  let events: { emit: ReturnType<typeof vi.fn> };
  let service: AlertsService;

  beforeEach(() => {
    repo = {
      create: vi.fn((input: Partial<Alert>) => input),
      save: vi.fn(async (input: Partial<Alert>) => storedAlert(input)),
      findAndCount: vi.fn().mockResolvedValue([[], 0]),
      findOne: vi.fn(),
      update: vi.fn().mockResolvedValue({ affected: 1 }),
      delete: vi.fn().mockResolvedValue({ affected: 1 }),
    };
    events = { emit: vi.fn() };
    service = new AlertsService(
      repo as unknown as Repository<Alert>,
      events as unknown as EventEmitter2,
    );
  });

  describe('ingest', () => {
    it('saves an open alert for the calling source and fires alert.created', async () => {
      const alert = await service.ingest(source, {
        title: 'Failed login',
        severity: AlertSeverity.HIGH,
        type: 'failed_login',
        ipAddress: '10.0.0.1',
      });

      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          status: AlertStatus.OPEN,
          sourceId: 'src-1',
          payload: {},
        }),
      );
      expect(events.emit).toHaveBeenCalledWith(
        ALERT_CREATED,
        new AlertCreatedEvent(alert),
      );
    });
  });

  describe('findAll', () => {
    it('defaults to page 1 of 20, newest first', async () => {
      repo.findAndCount.mockResolvedValue([[storedAlert()], 45]);

      const result = await service.findAll(query());

      expect(repo.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 0, take: 20, where: {} }),
      );
      expect(result.meta).toEqual({
        page: 1,
        limit: 20,
        total: 45,
        totalPages: 3,
      });
    });

    it('applies filters and the page offset', async () => {
      await service.findAll(
        query({
          severity: AlertSeverity.HIGH,
          status: AlertStatus.OPEN,
          from: '2026-11-01T00:00:00Z',
          page: 3,
          limit: 10,
        }),
      );

      const call = repo.findAndCount.mock.calls[0][0];
      expect(call.skip).toBe(20);
      expect(call.take).toBe(10);
      expect(call.where.severity).toBe('high');
      expect(call.where.status).toBe('open');
      expect(call.where.createdAt).toBeDefined();
    });

    it('rejects from after to with 400', async () => {
      await expect(
        service.findAll(
          query({ from: '2026-11-10T00:00:00Z', to: '2026-11-01T00:00:00Z' }),
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('findOne', () => {
    it('throws 404 when the alert does not exist', async () => {
      repo.findOne.mockResolvedValue(null);
      await expect(service.findOne('missing')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('updateStatus', () => {
    it('acknowledges an open alert and fires alert.status_changed', async () => {
      repo.findOne.mockResolvedValue(storedAlert());

      const result = await service.updateStatus(
        'alert-1',
        AlertStatus.ACKNOWLEDGED,
        'user-1',
      );

      expect(result.status).toBe(AlertStatus.ACKNOWLEDGED);
      expect(repo.update).toHaveBeenCalledWith(
        { id: 'alert-1', status: AlertStatus.OPEN },
        { status: AlertStatus.ACKNOWLEDGED },
      );
      expect(events.emit).toHaveBeenCalledWith(
        ALERT_STATUS_CHANGED,
        expect.objectContaining({
          alertId: 'alert-1',
          userId: 'user-1',
          from: AlertStatus.OPEN,
          to: AlertStatus.ACKNOWLEDGED,
        }),
      );
    });

    it('refuses to move a resolved alert backwards (409)', async () => {
      repo.findOne.mockResolvedValue(
        storedAlert({ status: AlertStatus.RESOLVED }),
      );
      await expect(
        service.updateStatus('alert-1', AlertStatus.ACKNOWLEDGED, 'user-1'),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(repo.update).not.toHaveBeenCalled();
    });

    it('returns 409 when another request changed the status first', async () => {
      repo.findOne.mockResolvedValue(storedAlert());
      repo.update.mockResolvedValue({ affected: 0 });
      await expect(
        service.updateStatus('alert-1', AlertStatus.RESOLVED, 'user-1'),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(events.emit).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('throws 404 when nothing was deleted', async () => {
      repo.delete.mockResolvedValue({ affected: 0 });
      await expect(service.remove('missing')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });
});
