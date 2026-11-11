import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, MoreThan, Repository } from 'typeorm';
import { BlockOrigin } from './entities/block-origin.enum.js';
import { BlockedIp } from './entities/blocked-ip.entity.js';
import {
  matcherFor,
  normalizeIp,
  overlaps,
  parseNetwork,
  type Network,
} from './network.js';

/**
 * How often each API instance reloads the blocklist from the database. A
 * change made on this instance applies at once; other instances pick it up
 * within this interval.
 */
export const REFRESH_INTERVAL_MS = 15_000;

export interface IpVerdict {
  ip: string;
  blocked: boolean;
  /** On FIREWALL_ALLOWLIST: never blocked, whatever the blocklist says. */
  allowlisted: boolean;
  reason: string | null;
  expiresAt: Date | null;
  blockedIpId: string | null;
}

export interface BlockInput {
  ip: string;
  reason?: string;
  expiresInMinutes?: number;
  origin: BlockOrigin;
  createdBy?: string | null;
  alertId?: string | null;
}

interface CachedBlock {
  row: BlockedIp;
  matches: (ip: string) => boolean;
}

/**
 * The IP filter. Keeps the active blocklist in memory, so checking an IP
 * (done on every request by FirewallMiddleware, and by integrated apps via
 * POST /firewall/check) never touches the database.
 */
@Injectable()
export class FirewallService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(FirewallService.name);
  private readonly allowlist: Network[];
  private blocks: CachedBlock[] = [];
  private timer: NodeJS.Timeout | undefined;

  constructor(
    @InjectRepository(BlockedIp)
    private readonly blockedIps: Repository<BlockedIp>,
    config: ConfigService,
  ) {
    this.allowlist = parseAllowlist(config.get<string>('FIREWALL_ALLOWLIST'));
  }

  async onModuleInit(): Promise<void> {
    await this.refresh();
    this.timer = setInterval(() => {
      this.refresh().catch((error: unknown) =>
        this.logger.error(
          `Blocklist refresh failed: ${error instanceof Error ? error.message : String(error)}`,
        ),
      );
    }, REFRESH_INTERVAL_MS);
    // Don't keep the process (or a test run) alive just for this timer.
    this.timer.unref();
  }

  onModuleDestroy(): void {
    clearInterval(this.timer);
  }

  /** Reloads the active blocks from the database. */
  async refresh(): Promise<void> {
    const rows = await this.findActive();
    this.blocks = rows.map((row) => ({
      row,
      matches: matcherFor(parseNetwork(row.network)),
    }));
  }

  check(rawIp: string, now = new Date()): IpVerdict {
    const ip = normalizeIp(rawIp);
    const verdict: IpVerdict = {
      ip,
      blocked: false,
      allowlisted: false,
      reason: null,
      expiresAt: null,
      blockedIpId: null,
    };
    if (this.isAllowlisted(ip)) return { ...verdict, allowlisted: true };

    const hit = this.blocks.find(
      ({ row, matches }) =>
        (!row.expiresAt || row.expiresAt > now) && matches(ip),
    );
    if (!hit) return verdict;
    return {
      ...verdict,
      blocked: true,
      reason: hit.row.reason,
      expiresAt: hit.row.expiresAt,
      blockedIpId: hit.row.id,
    };
  }

  /** Active blocks, newest first. */
  list(): Promise<BlockedIp[]> {
    return this.findActive();
  }

  /**
   * Adds a block. `requesterIp` is the admin's own address: a block that
   * would cover it is refused, so an admin can't lock themselves out.
   */
  async block(input: BlockInput, requesterIp?: string): Promise<BlockedIp> {
    let network: Network;
    try {
      network = parseNetwork(input.ip);
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Invalid IP',
      );
    }

    if (this.allowlist.some((allowed) => overlaps(allowed, network))) {
      throw new BadRequestException(
        `${network.cidr} overlaps FIREWALL_ALLOWLIST and can't be blocked`,
      );
    }
    if (requesterIp && matcherFor(network)(requesterIp)) {
      throw new BadRequestException(
        `${network.cidr} includes your own IP (${normalizeIp(requesterIp)})`,
      );
    }

    const existing = (await this.findActive()).find(
      (row) => row.network === network.cidr,
    );
    if (existing) {
      throw new ConflictException(`${network.cidr} is already blocked`);
    }

    const row = await this.blockedIps.save(
      this.blockedIps.create({
        network: network.cidr,
        reason: input.reason?.trim() || 'Blocked by an admin',
        origin: input.origin,
        createdBy: input.createdBy ?? null,
        alertId: input.alertId ?? null,
        expiresAt: input.expiresInMinutes
          ? new Date(Date.now() + input.expiresInMinutes * 60_000)
          : null,
      }),
    );
    await this.refresh();
    this.logger.warn(
      `Blocked ${row.network} (${row.origin}${row.expiresAt ? `, until ${row.expiresAt.toISOString()}` : ', permanent'}): ${row.reason}`,
    );
    return row;
  }

  async unblock(id: string): Promise<void> {
    const result = await this.blockedIps.delete({ id });
    if (!result.affected)
      throw new NotFoundException(`Blocked IP ${id} not found`);
    await this.refresh();
  }

  isAllowlisted(ip: string): boolean {
    return this.allowlist.some((allowed) => matcherFor(allowed)(ip));
  }

  private findActive(): Promise<BlockedIp[]> {
    return this.blockedIps.find({
      where: [{ expiresAt: IsNull() }, { expiresAt: MoreThan(new Date()) }],
      order: { createdAt: 'DESC' },
    });
  }
}

/** FIREWALL_ALLOWLIST: comma-separated IPs or CIDR ranges. Validated at startup (env.validation.ts). */
export function parseAllowlist(value: string | undefined): Network[] {
  return (
    (value ?? '')
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean)
      // Any width is fine here: trusting a wide range (e.g. 10.0.0.0/8) is not dangerous.
      .map((entry) => parseNetwork(entry, { allowWide: true }))
  );
}
