import { ConflictException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { randomBytes } from 'node:crypto';
import { Repository } from 'typeorm';
import type { CreateSourceDto } from './dto/create-source.dto.js';
import { Source } from './entities/source.entity.js';

/** What `POST /sources` returns. `apiKey` is shown this one time only. */
export type CreatedSource = Omit<Source, 'apiKeyHash'> & { apiKey: string };

const KEY_PREFIX = 'sa_';
/** `sa_` plus 8 random characters, stored in plain text for the lookup. */
const LOOKUP_PREFIX_LENGTH = KEY_PREFIX.length + 8;
const BCRYPT_ROUNDS = 10;

@Injectable()
export class SourcesService {
  constructor(
    @InjectRepository(Source) private readonly sources: Repository<Source>,
  ) {}

  static generateApiKey(): string {
    return `${KEY_PREFIX}${randomBytes(32).toString('base64url')}`;
  }

  static lookupPrefix(apiKey: string): string {
    return apiKey.slice(0, LOOKUP_PREFIX_LENGTH);
  }


  async findActiveByApiKey(apiKey: string): Promise<Source | null> {
    if (!apiKey.startsWith(KEY_PREFIX)) return null;

    const candidates = await this.sources
      .createQueryBuilder('source')
      .addSelect('source.apiKeyHash')
      .where('source.apiKeyPrefix = :prefix', {
        prefix: SourcesService.lookupPrefix(apiKey),
      })
      .andWhere('source.isActive = true')
      .getMany();

    for (const candidate of candidates) {
      if (await bcrypt.compare(apiKey, candidate.apiKeyHash)) {
        const { apiKeyHash: _omit, ...safe } = candidate;
        return safe as Source;
      }
    }
    return null;
  }

  async create(dto: CreateSourceDto): Promise<CreatedSource> {
    const existing = await this.sources.findOne({ where: { name: dto.name } });
    if (existing) {
      throw new ConflictException('A source with this name already exists');
    }

    const apiKey = SourcesService.generateApiKey();
    const saved = await this.sources.save(
      this.sources.create({
        name: dto.name,
        apiKeyPrefix: SourcesService.lookupPrefix(apiKey),
        apiKeyHash: await bcrypt.hash(apiKey, BCRYPT_ROUNDS),
      }),
    );
    const { apiKeyHash: _omit, ...safe } = saved;
    return { ...safe, apiKey };
  }

  findAll(): Promise<Source[]> {
    return this.sources.find({ order: { createdAt: 'DESC' } });
  }
}
