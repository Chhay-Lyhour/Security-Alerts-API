import {
  ForbiddenException,
  Injectable,
  Logger,
  type NestMiddleware,
} from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { getRequestContext } from '../auth/detection/request-context.js';
import { FirewallService } from './firewall.service.js';

export const BLOCKED_MESSAGE = 'Access denied';

/**
 * Runs before every route, ahead of guards, so a blocked IP is turned away
 * before it can try a password, an API key or a token. Uses the same client
 * IP as login detection (respects TRUST_PROXY).
 */
@Injectable()
export class FirewallMiddleware implements NestMiddleware {
  private readonly logger = new Logger('Firewall');

  constructor(private readonly firewall: FirewallService) {}

  use(req: Request, _res: Response, next: NextFunction): void {
    const { ip } = getRequestContext(req);
    const verdict = this.firewall.check(ip);
    if (verdict.blocked) {
      this.logger.warn(
        `Blocked ${req.method} ${req.originalUrl} ip=${ip} rule=${verdict.blockedIpId}`,
      );
      // Deliberately vague: the caller learns nothing about why or for how long.
      throw new ForbiddenException(BLOCKED_MESSAGE);
    }
    next();
  }
}
