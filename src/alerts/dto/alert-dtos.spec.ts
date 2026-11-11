import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { CreateAlertDto } from './create-alert.dto.js';
import { QueryAlertsDto } from './query-alerts.dto.js';
import { UpdateAlertStatusDto } from './update-alert-status.dto.js';

const errorsFor = <T extends object>(cls: new () => T, plain: object) =>
  validateSync(plainToInstance(cls, plain) as object, {
    whitelist: true,
    forbidNonWhitelisted: true,
  }).map((e) => e.property);

describe('alert DTOs', () => {
  it('accepts a valid alert', () => {
    expect(
      errorsFor(CreateAlertDto, {
        title: 'Failed login',
        severity: 'high',
        type: 'failed_login',
        ipAddress: '203.0.113.7',
        payload: { username: 'bob' },
      }),
    ).toEqual([]);
  });

  it('rejects bad severity, type, ip and payload, and unknown fields', () => {
    expect(
      errorsFor(CreateAlertDto, {
        title: ' ',
        severity: 'urgent',
        type: 'Failed Login',
        ipAddress: 'not-an-ip',
        payload: 'text',
        sourceId: 'spoofed',
      }).sort(),
    ).toEqual([
      'ipAddress',
      'payload',
      'severity',
      'sourceId',
      'title',
      'type',
    ]);
  });

  it('turns page and limit from the query string into numbers', () => {
    const dto = plainToInstance(QueryAlertsDto, { page: '2', limit: '50' });
    expect(dto.page).toBe(2);
    expect(dto.limit).toBe(50);
    expect(errorsFor(QueryAlertsDto, { page: '2', limit: '50' })).toEqual([]);
  });

  it('caps limit at 100 and rejects bad dates', () => {
    expect(
      errorsFor(QueryAlertsDto, { limit: '500', from: 'yesterday' }).sort(),
    ).toEqual(['from', 'limit']);
  });

  it('only allows acknowledged or resolved as a new status', () => {
    expect(errorsFor(UpdateAlertStatusDto, { status: 'resolved' })).toEqual([]);
    expect(errorsFor(UpdateAlertStatusDto, { status: 'open' })).toEqual([
      'status',
    ]);
  });
});
