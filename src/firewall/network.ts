import { BlockList, isIP } from 'node:net';

export type IpFamily = 'ipv4' | 'ipv6';

/** A single address or a CIDR range, e.g. `203.0.113.7/32` or `2001:db8::/48`. */
export interface Network {
  address: string;
  prefix: number;
  family: IpFamily;
  /** Normalised `address/prefix`, the form stored in the database. */
  cidr: string;
}

/**
 * The widest ranges that can be blocked. Anything bigger (e.g. 0.0.0.0/0)
 * is almost certainly a typo that would cut off far more than intended.
 */
export const MIN_PREFIX: Record<IpFamily, number> = { ipv4: 8, ipv6: 32 };
const MAX_PREFIX: Record<IpFamily, number> = { ipv4: 32, ipv6: 128 };

/** Same form request-context.ts gives req.ip: no IPv4-mapped prefix, lowercase. */
export function normalizeIp(ip: string): string {
  return ip
    .trim()
    .toLowerCase()
    .replace(/^::ffff:(?=\d+\.\d+\.\d+\.\d+$)/, '');
}

export function familyOf(ip: string): IpFamily | null {
  const version = isIP(ip);
  if (version === 4) return 'ipv4';
  if (version === 6) return 'ipv6';
  return null;
}

/**
 * Parses `1.2.3.4`, `1.2.3.0/24` or an IPv6 equivalent. Throws with a
 * readable message. `allowWide` skips the MIN_PREFIX limit, for allowlists.
 */
export function parseNetwork(
  input: string,
  { allowWide = false } = {},
): Network {
  const [rawAddress, rawPrefix, ...rest] = input.trim().split('/');
  const address = normalizeIp(rawAddress ?? '');
  const family = familyOf(address);
  if (!family || rest.length > 0) {
    throw new Error(`"${input}" is not a valid IP address or CIDR range`);
  }

  let prefix = MAX_PREFIX[family];
  if (rawPrefix !== undefined) {
    if (
      !/^\d{1,3}$/.test(rawPrefix) ||
      Number(rawPrefix) > MAX_PREFIX[family]
    ) {
      throw new Error(`"${input}" has an invalid prefix length`);
    }
    prefix = Number(rawPrefix);
  }
  if (!allowWide && prefix < MIN_PREFIX[family]) {
    throw new Error(
      `"${input}" is too wide; the widest allowed range is /${MIN_PREFIX[family]}`,
    );
  }

  return { address, prefix, family, cidr: `${address}/${prefix}` };
}

/** A compiled matcher for one network, so per-request checks stay cheap. */
export function matcherFor(network: Network): (ip: string) => boolean {
  const list = new BlockList();
  list.addSubnet(network.address, network.prefix, network.family);
  return (ip) => {
    const normalized = normalizeIp(ip);
    const family = familyOf(normalized);
    return family === network.family && list.check(normalized, family);
  };
}

/** True when the two networks share at least one address. */
export function overlaps(a: Network, b: Network): boolean {
  return (
    a.family === b.family &&
    (matcherFor(a)(b.address) || matcherFor(b)(a.address))
  );
}
