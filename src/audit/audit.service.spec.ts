import { BadRequestException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import type { AuditEntry } from './audit-actions.js';
import { AuditService } from './audit.service.js';
import { AuditLog } from './entities/audit-log.entity.js';
import { AuditOutcome } from './entities/audit-outcome.enum.js';
import type { QueryAuditDto } from './dto/query-audit.dto.js';

const entry: AuditEntry = {
  userId: 'u-1',
  actorEmail: 'a@example.com',
  actorRole: 'admin',
  action: 'deleted_alert',
  outcome: AuditOutcome.SUCCESS,
  targetType: 'alert',
  targetId: 'al-1',
  method: 'DELETE',
  path: '/alerts/al-1',
  statusCode: 204,
  ip: '10.0.0.1',
  metadata: {},
};

describe('AuditService', () => {
  let service: AuditService;
  const repo = {
    create: vi.fn((data: Partial<AuditLog>) => data),
    save: vi.fn(),
    findAndCount: vi.fn(),
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    const module = await Test.createTestingModule({
      providers: [
        AuditService,
        { provide: getRepositoryToken(AuditLog), useValue: repo },
      ],
    }).compile();
    service = module.get(AuditService);
  });

  it('saves the entry', async () => {
    await service.record(entry);
    expect(repo.save).toHaveBeenCalledWith(entry);
  });

  it('never throws when the database write fails', async () => {
    repo.save.mockRejectedValueOnce(new Error('connection lost'));
    await expect(service.record(entry)).resolves.toBeUndefined();
  });

  it('filters, sorts newest first and paginates', async () => {
    repo.findAndCount.mockResolvedValueOnce([[{ id: 'x' }], 41]);
    const result = await service.findAll({
      action: 'deleted_alert',
      outcome: AuditOutcome.SUCCESS,
      userId: 'u-1',
      page: 3,
      limit: 20,
    } as QueryAuditDto);

    expect(result).toEqual({
      data: [{ id: 'x' }],
      total: 41,
      page: 3,
      limit: 20,
    });
    expect(repo.findAndCount).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          action: 'deleted_alert',
          outcome: AuditOutcome.SUCCESS,
          userId: 'u-1',
        },
        order: { createdAt: 'DESC', id: 'DESC' },
        skip: 40,
        take: 20,
      }),
    );
  });

  it('rejects a from date after the to date', async () => {
    await expect(
      service.findAll({
        from: '2026-02-01T00:00:00Z',
        to: '2026-01-01T00:00:00Z',
        page: 1,
        limit: 20,
      } as QueryAuditDto),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
