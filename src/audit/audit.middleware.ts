import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { getRequestContext } from '../auth/detection/request-context.js';
import type { AuthUser } from '../common/types/auth-user.type.js';
import { describeRequest } from './audit-actions.js';
import { AuditService } from './audit.service.js';

/**
 * Records privileged actions without each controller having to call the
 * audit service. It waits until the response is sent, because only then
 * are the logged-in user (set by the JWT guard), the matched route and the
 * status code all known. PRIVILEGED_ROUTES decides what gets recorded.
 */
@Injectable()
export class AuditMiddleware implements NestMiddleware {
  constructor(private readonly audit: AuditService) {}

  use(req: Request, res: Response, next: NextFunction): void {
    // Keep the response body so a create action can record the new record's id.
    let responseBody: unknown;
    const json = res.json.bind(res);
    res.json = (body: unknown) => {
      responseBody = body;
      return json(body);
    };

    res.on('finish', () => {
      const entry = describeRequest({
        method: req.method,
        route: (req.route as { path?: string } | undefined)?.path,
        url: req.originalUrl,
        statusCode: res.statusCode,
        user: req.user as AuthUser | undefined,
        params: req.params ?? {},
        body: req.body,
        responseBody,
        ip: getRequestContext(req).ip,
      });
      if (entry) void this.audit.record(entry);
    });

    next();
  }
}
