import { GUARDS_METADATA } from '@nestjs/common/constants.js';
import { Test, TestingModule } from '@nestjs/testing';
import type { Request } from 'express';
import { IS_PUBLIC_KEY } from '../common/decorators/public.decorator.js';
import { ROLES_KEY } from '../common/decorators/roles.decorator.js';
import { ApiKeyGuard } from '../common/guards/api-key.guard.js';
import type { Source } from '../sources/entities/source.entity.js';
import { UserRole } from '../users/entities/user-role.enum.js';
import { AlertsController } from './alerts.controller.js';
import { AlertsService } from './alerts.service.js';
import { QueryAlertsDto } from './dto/query-alerts.dto.js';
import { AlertSeverity } from './entities/alert-severity.enum.js';
import { AlertStatus } from './entities/alert-status.enum.js';

/** Reads route metadata set by decorators on a controller method. */
const meta = (key: string, method: keyof AlertsController): unknown =>
  Reflect.getMetadata(
    key,
    Object.getOwnPropertyDescriptor(AlertsController.prototype, method)!.value,
  );

const ALERT_ID = '0a6a2146-e66f-4d9b-8a19-75070ea2050d';

describe('AlertsController', () => {
  let controller: AlertsController;
  let service: Record<
    'ingest' | 'findAll' | 'findOne' | 'updateStatus' | 'remove',
    ReturnType<typeof vi.fn>
  >;

  beforeEach(async () => {
    service = {
      ingest: vi.fn().mockResolvedValue({ id: ALERT_ID }),
      findAll: vi.fn().mockResolvedValue({ data: [], meta: { total: 0 } }),
      findOne: vi.fn().mockResolvedValue({ id: ALERT_ID }),
      updateStatus: vi.fn().mockResolvedValue({
        id: ALERT_ID,
        status: AlertStatus.ACKNOWLEDGED,
      }),
      remove: vi.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AlertsController],
      providers: [{ provide: AlertsService, useValue: service }],
    })
      // The real guard needs SourcesService; these tests call handlers directly.
      .overrideGuard(ApiKeyGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get(AlertsController);
  });

  it('is defined', () => {
    expect(controller).toBeDefined();
  });

  describe('POST /alerts (ingest)', () => {
    const dto = {
      title: 'Failed login',
      severity: AlertSeverity.HIGH,
      type: 'failed_login',
    };

    it('passes the source set by ApiKeyGuard and the body to the service', async () => {
      const source = { id: 'src-1' } as Source;
      const req = { source } as Request;

      await expect(controller.ingest(req, dto)).resolves.toEqual({
        id: ALERT_ID,
      });
      expect(service.ingest).toHaveBeenCalledWith(source, dto);
    });

    it('is public for JWT but protected by ApiKeyGuard', () => {
      expect(meta(IS_PUBLIC_KEY, 'ingest')).toBe(true);
      expect(meta(GUARDS_METADATA, 'ingest')).toEqual([ApiKeyGuard]);
    });
  });

  describe('GET /alerts', () => {
    it('forwards the query to the service', async () => {
      const query = Object.assign(new QueryAlertsDto(), {
        severity: AlertSeverity.HIGH,
        page: 2,
      });

      await controller.findAll(query);
      expect(service.findAll).toHaveBeenCalledWith(query);
    });

    it('is open to admins and analysts', () => {
      expect(meta(ROLES_KEY, 'findAll')).toEqual([
        UserRole.ADMIN,
        UserRole.ANALYST,
      ]);
      expect(meta(IS_PUBLIC_KEY, 'findAll')).toBeUndefined();
    });
  });

  describe('GET /alerts/:id', () => {
    it('returns the alert from the service', async () => {
      await expect(controller.findOne(ALERT_ID)).resolves.toEqual({
        id: ALERT_ID,
      });
      expect(service.findOne).toHaveBeenCalledWith(ALERT_ID);
    });
  });

  describe('PATCH /alerts/:id/status', () => {
    it('passes the id, new status and current user id to the service', async () => {
      const result = await controller.updateStatus(
        ALERT_ID,
        { status: AlertStatus.ACKNOWLEDGED },
        'user-1',
      );

      expect(result.status).toBe(AlertStatus.ACKNOWLEDGED);
      expect(service.updateStatus).toHaveBeenCalledWith(
        ALERT_ID,
        AlertStatus.ACKNOWLEDGED,
        'user-1',
      );
    });

    it('is open to admins and analysts', () => {
      expect(meta(ROLES_KEY, 'updateStatus')).toEqual([
        UserRole.ADMIN,
        UserRole.ANALYST,
      ]);
    });
  });

  describe('DELETE /alerts/:id', () => {
    it('deletes through the service', async () => {
      await controller.remove(ALERT_ID);
      expect(service.remove).toHaveBeenCalledWith(ALERT_ID);
    });

    it('is admin only', () => {
      expect(meta(ROLES_KEY, 'remove')).toEqual([UserRole.ADMIN]);
    });
  });
});
