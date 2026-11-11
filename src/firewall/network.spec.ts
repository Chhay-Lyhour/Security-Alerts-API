import { matcherFor, normalizeIp, overlaps, parseNetwork } from './network.js';

describe('parseNetwork', () => {
  it.each([
    ['203.0.113.7', '203.0.113.7/32', 'ipv4'],
    ['203.0.113.0/24', '203.0.113.0/24', 'ipv4'],
    [' ::ffff:203.0.113.7 ', '203.0.113.7/32', 'ipv4'],
    ['2001:DB8::1', '2001:db8::1/128', 'ipv6'],
    ['2001:db8::/48', '2001:db8::/48', 'ipv6'],
  ])('parses %s', (input, cidr, family) => {
    expect(parseNetwork(input)).toMatchObject({ cidr, family });
  });

  it.each([
    '',
    'hello',
    '300.1.1.1',
    '1.2.3.4/33',
    '1.2.3.4/-1',
    '1.2.3.4/abc',
    '1.2.3.4/24/1',
    '2001:db8::/129',
  ])('rejects %j', (input) => {
    expect(() => parseNetwork(input)).toThrow();
  });

  it.each(['0.0.0.0/0', '10.0.0.0/7', '::/0', '2001::/16'])(
    'refuses a range as wide as %s',
    (input) => {
      expect(() => parseNetwork(input)).toThrow('too wide');
    },
  );

  it('allows wide ranges when asked (for allowlists)', () => {
    expect(parseNetwork('0.0.0.0/0', { allowWide: true }).cidr).toBe(
      '0.0.0.0/0',
    );
  });
});

describe('matcherFor', () => {
  const range = matcherFor(parseNetwork('203.0.113.0/24'));

  it('matches addresses inside the range, including IPv4-mapped IPv6', () => {
    expect(range('203.0.113.1')).toBe(true);
    expect(range('203.0.113.255')).toBe(true);
    expect(range('::ffff:203.0.113.9')).toBe(true);
  });

  it('does not match addresses outside it, or of the other family', () => {
    expect(range('203.0.114.1')).toBe(false);
    expect(range('2001:db8::1')).toBe(false);
    expect(range('not-an-ip')).toBe(false);
  });

  it('matches IPv6 ranges', () => {
    const v6 = matcherFor(parseNetwork('2001:db8::/32'));
    expect(v6('2001:db8:1234::5')).toBe(true);
    expect(v6('2001:db9::1')).toBe(false);
  });
});

describe('overlaps', () => {
  it('is true when either network contains the other', () => {
    expect(
      overlaps(parseNetwork('10.0.0.0/16'), parseNetwork('10.0.5.7')),
    ).toBe(true);
    expect(
      overlaps(parseNetwork('10.0.5.7'), parseNetwork('10.0.0.0/16')),
    ).toBe(true);
  });

  it('is false for separate networks', () => {
    expect(
      overlaps(parseNetwork('10.0.0.0/16'), parseNetwork('10.1.0.0/16')),
    ).toBe(false);
  });
});

describe('normalizeIp', () => {
  it('strips the IPv4-mapped prefix but leaves real IPv6 alone', () => {
    expect(normalizeIp('::ffff:127.0.0.1')).toBe('127.0.0.1');
    expect(normalizeIp('::FFFF:ABCD')).toBe('::ffff:abcd');
  });
});
