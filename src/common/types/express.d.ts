import type { Source } from '../../sources/entities/source.entity.js';

declare global {
  namespace Express {
    interface Request {
      /** Set by ApiKeyGuard for requests from an external system. */
      source?: Source;
    }
  }
}

export {};
