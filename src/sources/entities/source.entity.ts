import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('sources')
export class Source {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 120, unique: true })
  name: string;

  /**
   * The first characters of the raw key (e.g. `sa_4PYcAqeK`). Stored in plain
   * text so ApiKeyGuard can find the one matching source before running a
   * slow bcrypt compare, instead of comparing against every source.
   */
  @Index('IDX_sources_apiKeyPrefix')
  @Column({ type: 'varchar', length: 16, nullable: true })
  apiKeyPrefix: string | null;

  // bcrypt hash of the raw API key. The raw key is only shown once, at creation.
  @Column({ type: 'varchar', length: 100, select: false })
  apiKeyHash: string;

  @Column({ type: 'boolean', default: true })
  isActive: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
