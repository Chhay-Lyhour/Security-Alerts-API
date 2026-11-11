import { createHash } from 'node:crypto';

export interface ParsedUserAgent {
  browser: string;
  os: string;
  deviceType: 'mobile' | 'tablet' | 'desktop';
}

/**
 * Small user-agent parser: only browser family, OS family and device type.
 * Version numbers are ignored on purpose, so a browser update does not look
 * like a brand-new device.
 */
export function parseUserAgent(userAgent: string): ParsedUserAgent {
  const ua = userAgent ?? '';
  return { browser: browserOf(ua), os: osOf(ua), deviceType: deviceTypeOf(ua) };
}

export interface DeviceFingerprint {
  fingerprint: string;
  name: string;
}

/**
 * Fingerprint = SHA-256 of browser + OS + device type, plus the optional
 * client device ID (X-Device-Id header). Without a device ID, two people with
 * the same browser and OS share a fingerprint; with one, it is per install.
 */
export function buildFingerprint(userAgent: string, deviceId: string | null): DeviceFingerprint {
  const { browser, os, deviceType } = parseUserAgent(userAgent);
  const fingerprint = createHash('sha256')
    .update([browser, os, deviceType, deviceId ?? ''].join('|'))
    .digest('hex');
  return { fingerprint, name: `${browser} on ${os}`.slice(0, 100) };
}

function osOf(ua: string): string {
  if (/iPhone|iPad|iPod/.test(ua)) return 'iOS';
  if (/Android/.test(ua)) return 'Android';
  if (/Windows/.test(ua)) return 'Windows';
  if (/CrOS/.test(ua)) return 'ChromeOS';
  if (/Mac OS X|Macintosh/.test(ua)) return 'macOS';
  if (/Linux/.test(ua)) return 'Linux';
  return 'Unknown OS';
}

function browserOf(ua: string): string {
  if (/Edg(e|A|iOS)?\//.test(ua)) return 'Edge';
  if (/OPR\/|Opera/.test(ua)) return 'Opera';
  if (/SamsungBrowser\//.test(ua)) return 'Samsung Internet';
  if (/Firefox\/|FxiOS\//.test(ua)) return 'Firefox';
  if (/Chrome\/|CriOS\//.test(ua)) return 'Chrome';
  if (/Safari\//.test(ua)) return 'Safari';
  // Tools such as curl, PostmanRuntime or python-requests: use their name.
  const tool = ua.split(/[/\s]/)[0]?.trim();
  return tool ? tool.slice(0, 40) : 'Unknown browser';
}

function deviceTypeOf(ua: string): ParsedUserAgent['deviceType'] {
  if (/iPad|Tablet/.test(ua)) return 'tablet';
  if (/Mobi|iPhone|Android/.test(ua)) return 'mobile';
  return 'desktop';
}
