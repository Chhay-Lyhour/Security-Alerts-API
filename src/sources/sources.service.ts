import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomToken, sha256Hex } from '../common/crypto.util.js';
import { Source } from './entities/source.entity.js';

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
}
