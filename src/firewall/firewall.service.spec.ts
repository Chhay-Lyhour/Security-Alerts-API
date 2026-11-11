import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BlockOrigin } from './entities/block-origin.enum.js';
import { BlockedIp } from './entities/blocked-ip.entity.js';
import { FirewallService, parseAllowlist } from './firewall.service.js';

describe('FirewallService', () => {
  let service: FirewallService;
  let rows: BlockedIp[];

  /** In-memory stand-in for the blocked_ips table. `find` returns what the service asked for: active rows. */
  const repo = {
    find: vi.fn(async () =>
      rows.filter((r) => !r.expiresAt || r.expiresAt > new Date()),
    ),
    create: vi.fn((data: Partial<BlockedIp>) => data),
    save: vi.fn(async (data: Partial<BlockedIp>) => {
      const row = {
        id: `b-${rows.length + 1}`,
        createdAt: new Date(),
        ...data,
      } as BlockedIp;
      rows.push(row);
      return row;
    }),
    delete: vi.fn(async ({ id }: { id: string }) => {
      const before = rows.length;
      rows = rows.filter((r) => r.id !== id);
      return { affected: before - rows.length };
    }),
  };

  const build = async (env: Record<string, string> = {}) => {
    const module = await Test.createTestingModule({
      providers: [
        FirewallService,
        { provide: getRepositoryToken(BlockedIp), useValue: repo },
        {
          provide: ConfigService,
          useValue: { get: (key: string) => env[key] },
        },
      ],
    }).compile();
    service = module.get(FirewallService);
    await service.refresh();
  };

  const row = (network: string, extra: Partial<BlockedIp> = {}): BlockedIp =>
    ({
      id: `seed-${network}`,
      network,
      reason: 'test',
      origin: BlockOrigin.MANUAL,
      createdBy: null,
      alertId: null,
      expiresAt: null,
      createdAt: new Date(),
      ...extra,
    }) as BlockedIp;

  beforeEach(async () => {
    vi.clearAllMocks();
    rows = [];
    await build();
  });

  describe('check', () => {
    it('blocks an IP inside a blocked range and says why', async () => {
      rows.push(row('203.0.113.0/24', { reason: 'scanner' }));
      await service.refresh();

      expect(service.check('203.0.113.50')).toMatchObject({
        blocked: true,
        reason: 'scanner',
        blockedIpId: 'seed-203.0.113.0/24',
      });
      expect(service.check('::ffff:203.0.113.50').blocked).toBe(true);
      expect(service.check('203.0.114.1').blocked).toBe(false);
    });

    it('stops blocking once a block expires, without waiting for a refresh', async () => {
      const expiresAt = new Date(Date.now() + 60_000);
      rows.push(row('198.51.100.7/32', { expiresAt }));
      await service.refresh();

      expect(service.check('198.51.100.7').blocked).toBe(true);
      expect(
        service.check('198.51.100.7', new Date(expiresAt.getTime() + 1))
          .blocked,
      ).toBe(false);
    });

    it('never blocks an allowlisted IP', async () => {
      await build({ FIREWALL_ALLOWLIST: '10.0.0.0/8, 192.0.2.1' });
      rows.push(row('10.1.2.3/32'));
      await service.refresh();

      expect(service.check('10.1.2.3')).toMatchObject({
        blocked: false,
        allowlisted: true,
      });
    });
  });

  describe('block', () => {
    it('saves a normalised network, applies it at once and sets the expiry', async () => {
      const before = Date.now();
      const saved = await service.block({
        ip: '::ffff:203.0.113.9',
        origin: BlockOrigin.MANUAL,
        createdBy: 'u-1',
        expiresInMinutes: 15,
      });

      expect(saved).toMatchObject({
        network: '203.0.113.9/32',
        origin: 'manual',
        createdBy: 'u-1',
        reason: 'Blocked by an admin',
      });
      expect(saved.expiresAt!.getTime()).toBeGreaterThanOrEqual(
        before + 15 * 60_000,
      );
      expect(service.check('203.0.113.9').blocked).toBe(true);
    });

    it('is permanent without expiresInMinutes', async () => {
      expect(
        (await service.block({ ip: '203.0.113.9', origin: BlockOrigin.MANUAL }))
          .expiresAt,
      ).toBeNull();
    });

    it.each(['nope', '0.0.0.0/0', '1.2.3.4/40'])(
      'rejects %j with 400',
      async (ip) => {
        await expect(
          service.block({ ip, origin: BlockOrigin.MANUAL }),
        ).rejects.toBeInstanceOf(BadRequestException);
      },
    );

    it("refuses to block the admin's own IP, even inside a range", async () => {
      await expect(
        service.block(
          { ip: '203.0.113.0/24', origin: BlockOrigin.MANUAL },
          '::ffff:203.0.113.77',
        ),
      ).rejects.toThrow('includes your own IP (203.0.113.77)');
    });

    it('refuses anything that overlaps the allowlist', async () => {
      await build({ FIREWALL_ALLOWLIST: '10.0.0.5' });
      await expect(
        service.block({ ip: '10.0.0.0/24', origin: BlockOrigin.MANUAL }),
      ).rejects.toThrow('FIREWALL_ALLOWLIST');
    });

    it('answers 409 when the same network is already blocked', async () => {
      await service.block({ ip: '203.0.113.9', origin: BlockOrigin.MANUAL });
      await expect(
        service.block({ ip: '203.0.113.9/32', origin: BlockOrigin.AUTO }),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('unblock', () => {
    it('removes the block and applies it at once', async () => {
      const saved = await service.block({
        ip: '203.0.113.9',
        origin: BlockOrigin.MANUAL,
      });
      await service.unblock(saved.id);
      expect(service.check('203.0.113.9').blocked).toBe(false);
    });

    it('answers 404 for an unknown id', async () => {
      await expect(service.unblock('missing')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });
});

describe('parseAllowlist', () => {
  it('reads a comma-separated list and skips blanks', () => {
    expect(parseAllowlist(' 10.0.0.0/8 , ,::1').map((n) => n.cidr)).toEqual([
      '10.0.0.0/8',
      '::1/128',
    ]);
    expect(parseAllowlist(undefined)).toEqual([]);
  });
});
