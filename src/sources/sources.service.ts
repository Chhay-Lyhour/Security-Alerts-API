import { ConflictException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomToken, sha256Hex } from '../common/crypto.util.js';
import type { CreateSourceDto } from './dto/create-source.dto.js';
import { Source } from './entities/source.entity.js';

/** What `POST /sources` returns. `apiKey` is shown this one time only. */
export type CreatedSource = Omit<Source, 'apiKeyHash'> & { apiKey: string };

@Injectable()
export class SourcesService {
  constructor(
    @InjectRepository(Source) private readonly sources: Repository<Source>,
  ) {}

  static generateApiKey(): string {
    return randomToken('sa_');
  }

  /** API keys are 256-bit random values, so we look them up by their SHA-256. */
  findActiveByApiKey(apiKey: string): Promise<Source | null> {
    return this.sources.findOne({
      where: { apiKeyHash: sha256Hex(apiKey), isActive: true },
    });
  }

  /**
   * Registers a source and issues its API key. Only the hash is stored, so the
   * raw key cannot be shown again; a lost key means registering a new source.
   */
  async create(dto: CreateSourceDto): Promise<CreatedSource> {
    const existing = await this.sources.findOne({ where: { name: dto.name } });
    if (existing) {
      throw new ConflictException('A source with this name already exists');
    }

    const apiKey = SourcesService.generateApiKey();
    const saved = await this.sources.save(
      this.sources.create({ name: dto.name, apiKeyHash: sha256Hex(apiKey) }),
    );
    const { apiKeyHash: _omit, ...safe } = saved;
    return { ...safe, apiKey };
  }

  /** Newest first. `apiKeyHash` is never selected (see the entity). */
  findAll(): Promise<Source[]> {
    return this.sources.find({ order: { createdAt: 'DESC' } });
  }
}
