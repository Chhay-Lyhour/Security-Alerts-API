import { buildFingerprint, parseUserAgent } from './fingerprint.js';

const CHROME_WIN_120 =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const CHROME_WIN_131 = CHROME_WIN_120.replace('Chrome/120.0.0.0', 'Chrome/131.0.0.0');
const EDGE_WIN = `${CHROME_WIN_120} Edg/120.0.0.0`;
const SAFARI_IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const FIREFOX_MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14.0; rv:121.0) Gecko/20100101 Firefox/121.0';

describe('parseUserAgent', () => {
  it.each([
    [CHROME_WIN_120, { browser: 'Chrome', os: 'Windows', deviceType: 'desktop' }],
    [EDGE_WIN, { browser: 'Edge', os: 'Windows', deviceType: 'desktop' }],
    [SAFARI_IPHONE, { browser: 'Safari', os: 'iOS', deviceType: 'mobile' }],
    [FIREFOX_MAC, { browser: 'Firefox', os: 'macOS', deviceType: 'desktop' }],
    ['curl/8.4.0', { browser: 'curl', os: 'Unknown OS', deviceType: 'desktop' }],
    ['', { browser: 'Unknown browser', os: 'Unknown OS', deviceType: 'desktop' }],
  ])('parses %s', (ua, expected) => {
    expect(parseUserAgent(ua)).toEqual(expected);
  });
});

describe('buildFingerprint', () => {
  it('ignores browser version updates', () => {
    expect(buildFingerprint(CHROME_WIN_120, null).fingerprint).toBe(
      buildFingerprint(CHROME_WIN_131, null).fingerprint,
    );
  });

  it('differs between browsers', () => {
    expect(buildFingerprint(CHROME_WIN_120, null).fingerprint).not.toBe(
      buildFingerprint(EDGE_WIN, null).fingerprint,
    );
  });

  it('includes the client device ID when sent', () => {
    expect(buildFingerprint(CHROME_WIN_120, 'device-aaaa').fingerprint).not.toBe(
      buildFingerprint(CHROME_WIN_120, 'device-bbbb').fingerprint,
    );
  });

  it('gives a readable name and a sha256 hex fingerprint', () => {
    const fp = buildFingerprint(SAFARI_IPHONE, null);
    expect(fp.name).toBe('Safari on iOS');
    expect(fp.fingerprint).toMatch(/^[a-f0-9]{64}$/);
  });
});
