import {
  CallHandler,
  ExecutionContext,
  HttpException,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Observable, tap } from 'rxjs';
import type { AuthUser } from '../types/auth-user.type.js';

/** Logs method, path, status, duration and caller for every HTTP request. */
@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();

    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();
    const startedAt = Date.now();

    const caller = () => {
      const user = request.user as AuthUser | undefined;
      if (user) return `user=${user.id}`;
      if (request.source) return `source=${request.source.id}`;
      return 'anonymous';
    };

    const format = (status: number) =>
      `${request.method} ${request.originalUrl} ${status} ${Date.now() - startedAt}ms ${caller()} ip=${request.ip}`;

    return next.handle().pipe(
      tap({
        next: () => this.logger.log(format(response.statusCode)),
        error: (error: unknown) => {
          const status = error instanceof HttpException ? error.getStatus() : 500;
          if (status >= 500) this.logger.error(format(status));
          else this.logger.warn(format(status));
        },
      }),
    );
  }
}
