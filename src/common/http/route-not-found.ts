import { NotFoundException } from '@nestjs/common';
import type { Request } from 'express';

/**
 * The exact 404 Nest returns for a route that does not exist (see
 * RoutesResolver in @nestjs/core). Guards throw this instead of 401/403 when
 * they want a protected route to look like it is not there.
 */
export const routeNotFound = (request: Request): NotFoundException =>
  new NotFoundException(`Cannot ${request.method} ${request.originalUrl}`);
