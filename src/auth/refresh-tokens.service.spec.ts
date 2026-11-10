import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Repository } from 'typeorm';
import { sha256Hex } from '../common/crypto.util.js';
import type { RefreshToken } from './entities/refresh-token.entity.js';
import { RefreshTokensService } from './refresh-tokens.service.js';

const row = (overrides: Partial<RefreshToken> = {}): RefreshToken => ({
  id: 'tok-1',
  userId: 'user-1',
  familyId: 'fam-1',
  tokenHash: sha256Hex('rt_old'),
  expiresAt: new Date(Date.now() + 60_000),
  usedAt: null,
  revokedAt: null,
  createdAt: new Date(),
  ...overrides,
});

describe('RefreshTokensService', () => {
  let repo: {
    insert: ReturnType<typeof vi.fn>;
    findOne: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  let service: RefreshTokensService;

  beforeEach(() => {
    repo = {
      insert: vi.fn().mockResolvedValue(undefined),
      findOne: vi.fn(),
      update: vi.fn().mockResolvedValue({ affected: 1 }),
    };
    service = new RefreshTokensService(
      repo as unknown as Repository<RefreshToken>,
      new ConfigService({ REFRESH_TOKEN_TTL_DAYS: '7' }),
    );
  });

  it('stores only the hash of an issued token', async () => {
    const raw = await service.issue('user-1');
    const saved = repo.insert.mock.calls[0]![0];
    expect(raw).toMatch(/^rt_/);
    expect(saved.tokenHash).toBe(sha256Hex(raw));
    expect(JSON.stringify(saved)).not.toContain(raw);
  });

  it('rotates a valid token into a new token from the same session', async () => {
    repo.findOne.mockResolvedValue(row());

    const result = await service.rotate('rt_old');

    expect(result.userId).toBe('user-1');
    expect(result.refreshToken).not.toBe('rt_old');
    expect(repo.insert.mock.calls[0]![0].familyId).toBe('fam-1');
  });

  it('rejects an unknown token', async () => {
    repo.findOne.mockResolvedValue(null);
    await expect(service.rotate('rt_nope')).rejects.toThrow(UnauthorizedException);
  });

  it('revokes every session for the user when a used token is replayed', async () => {
    repo.findOne.mockResolvedValue(row({ usedAt: new Date() }));
    repo.update.mockResolvedValueOnce({ affected: 0 });

    await expect(service.rotate('rt_old')).rejects.toThrow(UnauthorizedException);
    expect(repo.update).toHaveBeenLastCalledWith(
      expect.objectContaining({ userId: 'user-1' }),
      expect.objectContaining({ revokedAt: expect.any(Date) }),
    );
    expect(repo.insert).not.toHaveBeenCalled();
  });

  it('rejects an expired or revoked token without revoking other sessions', async () => {
    repo.findOne.mockResolvedValue(row({ revokedAt: new Date() }));
    repo.update.mockResolvedValueOnce({ affected: 0 });

    await expect(service.rotate('rt_old')).rejects.toThrow(UnauthorizedException);
    expect(repo.update).toHaveBeenCalledTimes(1);
  });

  it('logout revokes the whole session family', async () => {
    repo.findOne.mockResolvedValue(row());
    await service.revokeSession('rt_old');
    expect(repo.update).toHaveBeenCalledWith(
      expect.objectContaining({ familyId: 'fam-1' }),
      expect.objectContaining({ revokedAt: expect.any(Date) }),
    );
  });
});
