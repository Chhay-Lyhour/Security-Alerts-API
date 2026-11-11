import { ConflictException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import type { Repository } from 'typeorm';
import type { Source } from './entities/source.entity.js';
import { SourcesService } from './sources.service.js';

describe('SourcesService', () => {
  let qb: {
    addSelect: ReturnType<typeof vi.fn>;
    where: ReturnType<typeof vi.fn>;
    andWhere: ReturnType<typeof vi.fn>;
    getMany: ReturnType<typeof vi.fn>;
  };
  let repo: {
    findOne: ReturnType<typeof vi.fn>;
    find: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    save: ReturnType<typeof vi.fn>;
    createQueryBuilder: ReturnType<typeof vi.fn>;
  };
  let service: SourcesService;

  beforeEach(() => {
    qb = {
      addSelect: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      andWhere: vi.fn().mockReturnThis(),
      getMany: vi.fn().mockResolvedValue([]),
    };
    repo = {
      findOne: vi.fn(),
      find: vi.fn(),
      create: vi.fn((input: Partial<Source>) => input),
      save: vi.fn(async (input: Partial<Source>) => ({
        id: 'src-1',
        isActive: true,
        createdAt: new Date(),
        ...input,
      })),
      createQueryBuilder: vi.fn(() => qb),
    };
    service = new SourcesService(repo as unknown as Repository<Source>);
  });

  describe('create', () => {
    it('returns the raw key once and stores only a bcrypt hash and a short prefix', async () => {
      repo.findOne.mockResolvedValue(null);

      const created = await service.create({ name: 'web-1' });

      expect(created.apiKey).toMatch(/^sa_[A-Za-z0-9_-]{43}$/);
      expect(created).not.toHaveProperty('apiKeyHash');
      const stored = repo.create.mock.calls[0][0] as Source;
      expect(stored.apiKeyPrefix).toBe(created.apiKey.slice(0, 11));
      expect(stored.apiKeyHash).toMatch(/^\$2[aby]\$10\$/);
      await expect(
        bcrypt.compare(created.apiKey, stored.apiKeyHash),
      ).resolves.toBe(true);
    });

    it('rejects a duplicate name with 409', async () => {
      repo.findOne.mockResolvedValue({ id: 'src-0', name: 'web-1' });
      await expect(service.create({ name: 'web-1' })).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(repo.save).not.toHaveBeenCalled();
    });
  });

  describe('findActiveByApiKey', () => {
    const key = 'sa_abcdefgh-rest-of-the-random-key';

    it('looks up by prefix and returns the source whose hash matches, without the hash', async () => {
      qb.getMany.mockResolvedValue([
        {
          id: 'other',
          apiKeyHash: await bcrypt.hash('sa_abcdefgh-different', 4),
        },
        { id: 'src-1', apiKeyHash: await bcrypt.hash(key, 4) },
      ]);

      const source = await service.findActiveByApiKey(key);

      expect(qb.where).toHaveBeenCalledWith('source.apiKeyPrefix = :prefix', {
        prefix: 'sa_abcdefgh',
      });
      expect(qb.andWhere).toHaveBeenCalledWith('source.isActive = true');
      expect(source).toEqual({ id: 'src-1' });
    });

    it('returns null when no hash matches', async () => {
      qb.getMany.mockResolvedValue([
        { id: 'src-1', apiKeyHash: await bcrypt.hash('sa_abcdefgh-other', 4) },
      ]);
      await expect(service.findActiveByApiKey(key)).resolves.toBeNull();
    });

    it('skips the database for keys without the sa_ prefix', async () => {
      await expect(service.findActiveByApiKey('nope')).resolves.toBeNull();
      expect(repo.createQueryBuilder).not.toHaveBeenCalled();
    });
  });
});
