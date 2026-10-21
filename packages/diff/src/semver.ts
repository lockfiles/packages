import type { Bump } from './types.js';

interface Version {
  numbers: [major: number, minor: number, patch: number];
  prerelease: string[];
}

const SEMVER =
  /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

function parse(version: string): Version | undefined {
  const match = SEMVER.exec(version);
  if (!match) return undefined;
  return {
    numbers: [Number(match[1]), Number(match[2]), Number(match[3])],
    prerelease: match[4] ? match[4].split('.') : [],
  };
}

const isNumeric = (identifier: string): boolean => /^\d+$/.test(identifier);

function comparePrerelease(a: string[], b: string[]): number {
  // A version without a prerelease is newer than one with it.
  if (a.length === 0 || b.length === 0) return Math.sign(b.length - a.length);
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const x = a[i]!;
    const y = b[i]!;
    if (x === y) continue;
    if (isNumeric(x) && isNumeric(y)) return Math.sign(Number(x) - Number(y));
    // Numbers are older than text.
    if (isNumeric(x)) return -1;
    if (isNumeric(y)) return 1;
    return x < y ? -1 : 1;
  }
  return Math.sign(a.length - b.length);
}

/** Compares two semver versions. Returns `undefined` if one of them is not a semver version. */
export function compareVersions(a: string, b: string): number | undefined {
  const x = parse(a);
  const y = parse(b);
  if (!x || !y) return undefined;
  for (let i = 0; i < 3; i++) {
    const difference = x.numbers[i]! - y.numbers[i]!;
    if (difference !== 0) return Math.sign(difference);
  }
  return comparePrerelease(x.prerelease, y.prerelease);
}

/** Tells how big the change between two semver versions is. Returns `undefined` if there is no change or a version is not semver. */
export function bumpOf(from: string, to: string): Bump | undefined {
  const x = parse(from);
  const y = parse(to);
  if (!x || !y) return undefined;
  if (x.numbers[0] !== y.numbers[0]) return 'major';
  if (x.numbers[1] !== y.numbers[1]) return 'minor';
  if (x.numbers[2] !== y.numbers[2]) return 'patch';
  return comparePrerelease(x.prerelease, y.prerelease) === 0 ? undefined : 'prerelease';
}

/** Sorts versions from old to new. Versions that are not semver are sorted as text. */
export function sortVersions(a: string, b: string): number {
  return compareVersions(a, b) ?? (a < b ? -1 : a > b ? 1 : 0);
}
