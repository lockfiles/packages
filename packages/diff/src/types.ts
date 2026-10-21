import type { GetAllOptions, LockEntry } from '@lockfiles/parse';

/** How big a version change is. */
export type Bump = 'major' | 'minor' | 'patch' | 'prerelease';

/** Same as the options of `Lockfile.getAll`. Set a type to `false` to ignore the packages of that type. */
export type DiffOptions = GetAllOptions;

/** A package that is in both lockfiles, but with different versions. */
export interface ChangedPackage {
  name: string;
  /** The versions that are only in the old lockfile. */
  before: LockEntry[];
  /** The versions that are only in the new lockfile. */
  after: LockEntry[];
  /** Set if there is exactly one version on each side and both are semver versions. */
  direction?: 'upgrade' | 'downgrade';
  /** Set together with `direction`. Tells how big the change is. */
  bump?: Bump;
}

/** The same package and version, but with a different integrity hash. This should not happen. */
export interface IntegrityChange {
  before: LockEntry;
  after: LockEntry;
}

export interface LockfileDiff {
  /** Packages that are only in the new lockfile. One entry for each version. */
  added: LockEntry[];
  /** Packages that are only in the old lockfile. One entry for each version. */
  removed: LockEntry[];
  /** Packages that are in both lockfiles, but with different versions. */
  changed: ChangedPackage[];
  /** Packages with the same version, but a different integrity hash. */
  integrityChanged: IntegrityChange[];
  /** `true` if nothing changed. */
  isEmpty: boolean;
}

export interface FormatOptions {
  /** Defaults to `text`. */
  format?: 'text' | 'markdown';
}
