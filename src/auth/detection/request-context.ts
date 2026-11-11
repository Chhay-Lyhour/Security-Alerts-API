import type { Request } from 'express';

export interface RequestContext {
  ip: string;
  userAgent: string;
  /** ISO 3166-1 alpha-2 country code, or null when unknown. */
  country: string | null;
  /** Optional stable ID the client sends in the X-Device-Id header. */
  deviceId: string | null;
}

/** Country headers set by common proxies/CDNs (Cloudflare, CloudFront, custom). */
const COUNTRY_HEADERS = ['cf-ipcountry', 'cloudfront-viewer-country', 'x-country-code'];
const DEVICE_ID_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;

/**
 * Reads the details login detection needs from a request.
 *
 * Country headers can be faked by any client, so they are only read when the
 * app runs behind a proxy we trust: TRUST_PROXY=<hops> in .env, which main.ts
 * turns into Express's "trust proxy" setting (that same setting makes req.ip
 * come from X-Forwarded-For).
 */
export function getRequestContext(req: Request): RequestContext {
  const trustProxy = Boolean(req.app?.get('trust proxy'));
  const rawIp = req.ip ?? req.socket?.remoteAddress ?? 'unknown';
  const ip = rawIp.replace(/^::ffff:/, '').slice(0, 45);

  const userAgent = String(req.headers['user-agent'] ?? '').slice(0, 512);

  let country: string | null = null;
  if (trustProxy) {
    for (const name of COUNTRY_HEADERS) {
      const value = String(req.headers[name] ?? '').trim().toUpperCase();
      // XX = unknown, T1 = Tor (Cloudflare); treat both as unknown.
      if (/^[A-Z]{2}$/.test(value) && value !== 'XX') {
        country = value;
        break;
      }
    }
  }

  const rawDeviceId = String(req.headers['x-device-id'] ?? '').trim();
  const deviceId = DEVICE_ID_PATTERN.test(rawDeviceId) ? rawDeviceId : null;

  return { ip, userAgent, country, deviceId };
}
