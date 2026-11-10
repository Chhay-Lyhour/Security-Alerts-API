import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { SourcesService } from '../../sources/sources.service.js';

export const API_KEY_HEADER = 'x-api-key';

/**
 * Authenticates external systems by the `x-api-key` header and attaches the
 * matching active Source to `request.source`. Use it together with `@Public()`
 * so the global JWT guard does not also demand a token:
 *
 *   @Public()
 *   @UseGuards(ApiKeyGuard)
 *   @Post()
 *   ingest(@Req() req: Request) { req.source ... }
 */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(private readonly sourcesService: SourcesService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const apiKey = request.header(API_KEY_HEADER);
    if (!apiKey) throw new UnauthorizedException('Missing API key');

    const source = await this.sourcesService.findActiveByApiKey(apiKey);
    if (!source) throw new UnauthorizedException('Invalid API key');

    request.source = source;
    return true;
  }
}
