import { ConflictException } from '@nestjs/common';
import type { Repository } from 'typeorm';
import { sha256Hex } from '../common/crypto.util.js';
import type { Source } from './entities/source.entity.js';
import { SourcesService } from './sources.service.js';

describe('SourcesService', () => {
  let repo: {
    findOne: ReturnType<typeof vi.fn>;
    find: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    save: ReturnType<typeof vi.fn>;
  };
  let service: SourcesService;

  beforeEach(() => {
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
    };
    service = new SourcesService(repo as unknown as Repository<Source>);
  });

  it('returns the raw key once and stores only its SHA-256', async () => {
    repo.findOne.mockResolvedValue(null);

    const created = await service.create({ name: 'web-1' });

    expect(created.apiKey).toMatch(/^sa_[A-Za-z0-9_-]{43}$/);
    expect(created).not.toHaveProperty('apiKeyHash');
    expect(repo.create).toHaveBeenCalledWith({
      name: 'web-1',
      apiKeyHash: sha256Hex(created.apiKey),
    });
  });

  it('rejects a duplicate name with 409', async () => {
    repo.findOne.mockResolvedValue({ id: 'src-0', name: 'web-1' });
    await expect(service.create({ name: 'web-1' })).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('looks up active sources by key hash', async () => {
    await service.findActiveByApiKey('sa_abc');
    expect(repo.findOne).toHaveBeenCalledWith({
      where: { apiKeyHash: sha256Hex('sa_abc'), isActive: true },
    });
  });
});
