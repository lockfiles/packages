import type { LockEntry } from '@lockfiles/parse';
import type { Tracker } from './tracker.js';
import type { EnrichedField, EnrichSource } from './types.js';
import { isRecord } from './util.js';

/** The parts of a `package.json` or a registry manifest that we read. */
export interface Manifest {
  license?: unknown;
  licenses?: unknown;
  engines?: unknown;
  bin?: unknown;
  os?: unknown;
  cpu?: unknown;
  libc?: unknown;
  deprecated?: unknown;
  hasInstallScript?: unknown;
  gypfile?: unknown;
  scripts?: unknown;
  dist?: unknown;
}

const stringList = (value: unknown): string[] | undefined => {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value) && value.every((item) => typeof item === 'string')) {
    return value as string[];
  }
  return undefined;
};

const stringRecord = (value: unknown): Record<string, string> | undefined => {
  if (!isRecord(value)) return undefined;
  const entries = Object.entries(value).filter(
    (entry): entry is [string, string] => typeof entry[1] === 'string',
  );
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
};

/** Reads the license, also from the old `license: { type }` and `licenses: [...]` forms. */
export function licenseOf(manifest: Manifest): string | undefined {
  const { license, licenses } = manifest;
  if (typeof license === 'string' && license.trim()) return license.trim();
  if (isRecord(license) && typeof license.type === 'string') return license.type;
  if (Array.isArray(licenses)) {
    const types = licenses
      .map((item) => (typeof item === 'string' ? item : isRecord(item) ? item.type : undefined))
      .filter((type): type is string => typeof type === 'string');
    if (types.length === 1) return types[0];
    if (types.length > 1) return `(${types.join(' OR ')})`;
  }
  return undefined;
}

/** A single `bin` path is named after the package. */
export function binOf(manifest: Manifest, packageName: string): Record<string, string> | undefined {
  if (typeof manifest.bin === 'string') {
    return { [packageName.slice(packageName.lastIndexOf('/') + 1)]: manifest.bin };
  }
  return stringRecord(manifest.bin);
}

const INSTALL_SCRIPTS = ['preinstall', 'install', 'postinstall'];

export function hasInstallScriptIn(manifest: Manifest, hasBindingGyp: boolean): boolean {
  if (manifest.hasInstallScript === true || manifest.gypfile === true || hasBindingGyp) return true;
  if (!isRecord(manifest.scripts)) return false;
  const scripts = manifest.scripts;
  return INSTALL_SCRIPTS.some((name) => typeof scripts[name] === 'string' && scripts[name] !== '');
}

/** Fills the wanted fields of an entry that are still empty from a manifest. */
export function applyManifest(
  tracker: Tracker,
  entry: LockEntry,
  manifest: Manifest,
  wanted: ReadonlySet<EnrichedField>,
  source: EnrichSource,
  options: { hasBindingGyp?: boolean } = {},
): void {
  const set = (field: EnrichedField, value: unknown): void => {
    if (wanted.has(field)) tracker.set(entry, field, value, source);
  };

  set('license', licenseOf(manifest));
  set('engines', stringRecord(manifest.engines));
  set('bin', binOf(manifest, entry.name));
  set('os', stringList(manifest.os));
  set('cpu', stringList(manifest.cpu));
  set('libc', stringList(manifest.libc));
  set(
    'hasInstallScript',
    hasInstallScriptIn(manifest, options.hasBindingGyp ?? false) ? true : undefined,
  );
  if (typeof manifest.deprecated === 'string' && manifest.deprecated !== '') {
    set('deprecated', manifest.deprecated);
  }
  if (isRecord(manifest.dist)) {
    set(
      'integrity',
      typeof manifest.dist.integrity === 'string' ? manifest.dist.integrity : undefined,
    );
    set('resolved', typeof manifest.dist.tarball === 'string' ? manifest.dist.tarball : undefined);
  }
}
