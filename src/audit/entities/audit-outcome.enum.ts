export enum AuditOutcome {
  /** The action went through (2xx). */
  SUCCESS = 'success',
  /** The caller was not allowed to do it (401 / 403). */
  DENIED = 'denied',
  /** Allowed, but it did not go through (404, 409, 400, 5xx...). */
  FAILED = 'failed',
}
