import { parseLockfile, type LockEntry, type Lockfile } from '@lockfiles/parse';
import { bumpOf, compareVersions, sortVersions } from './semver.js';
import type { ChangedPackage, DiffOptions, IntegrityChange, LockfileDiff } from './types.js';

/** Groups the packages by name. Workspace packages belong to the project and are left out. */
function groupByName(lockfile: Lockfile, options: DiffOptions): Map<string, LockEntry[]> {
  const byName = new Map<string, LockEntry[]>();
  for (const entry of lockfile.getAll(options)) {
    if (entry.source === 'workspace') continue;
    const list = byName.get(entry.name);
    if (list) list.push(entry);
    else byName.set(entry.name, [entry]);
  }
  for (const list of byName.values()) list.sort((a, b) => sortVersions(a.version, b.version));
  return byName;
}

const byNameAndVersion = (a: LockEntry, b: LockEntry): number =>
  a.name < b.name ? -1 : a.name > b.name ? 1 : sortVersions(a.version, b.version);

function toChanged(name: string, before: LockEntry[], after: LockEntry[]): ChangedPackage {
  const changed: ChangedPackage = { name, before, after };
  const [from, to] = [before[0], after[0]];
  if (before.length === 1 && after.length === 1 && from && to) {
    const order = compareVersions(from.version, to.version);
    if (order) {
      changed.direction = order < 0 ? 'upgrade' : 'downgrade';
      changed.bump = bumpOf(from.version, to.version);
    }
  }
  return changed;
}

/**
 * Compares two lockfiles. They can come from different package managers.
 * Packages are matched by name. Workspace packages are ignored.
 *
 * @param before The old lockfile.
 * @param after The new lockfile.
 * @param options Set a type (`prod`, `dev`, `optional` or `peer`) to `false` to ignore its packages. Same as `Lockfile.getAll`.
 */
export function diffLockfiles(
  before: Lockfile,
  after: Lockfile,
  options: DiffOptions = {},
): LockfileDiff {
  const oldPackages = groupByName(before, options);
  const newPackages = groupByName(after, options);

  const added: LockEntry[] = [];
  const removed: LockEntry[] = [];
  const changed: ChangedPackage[] = [];
  const integrityChanged: IntegrityChange[] = [];

  for (const [name, oldEntries] of oldPackages) {
    const newEntries = newPackages.get(name);
    if (!newEntries) {
      removed.push(...oldEntries);
      continue;
    }

    for (const oldEntry of oldEntries) {
      const newEntry = newEntries.find((entry) => entry.version === oldEntry.version);
      // Yarn berry has no integrity hash, so there is nothing to compare for it.
      if (newEntry?.integrity && oldEntry.integrity && newEntry.integrity !== oldEntry.integrity) {
        integrityChanged.push({ before: oldEntry, after: newEntry });
      }
    }

    const oldOnly = oldEntries.filter((o) => !newEntries.some((n) => n.version === o.version));
    const newOnly = newEntries.filter((n) => !oldEntries.some((o) => o.version === n.version));
    if (oldOnly.length > 0 || newOnly.length > 0) changed.push(toChanged(name, oldOnly, newOnly));
  }

  for (const [name, newEntries] of newPackages) {
    if (!oldPackages.has(name)) added.push(...newEntries);
  }

  added.sort(byNameAndVersion);
  removed.sort(byNameAndVersion);
  changed.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  integrityChanged.sort((a, b) => byNameAndVersion(a.before, b.before));

  return {
    added,
    removed,
    changed,
    integrityChanged,
    isEmpty: added.length + removed.length + changed.length + integrityChanged.length === 0,
  };
}

/**
 * Parses two lockfiles and compares them. Each input is the path to a lockfile or its content, like in `parseLockfile`.
 */
export async function diffLockfileFiles(
  before: string,
  after: string,
  options: DiffOptions = {},
): Promise<LockfileDiff> {
  const [oldLockfile, newLockfile] = await Promise.all([
    parseLockfile(before),
    parseLockfile(after),
  ]);
  return diffLockfiles(oldLockfile, newLockfile, options);
}
