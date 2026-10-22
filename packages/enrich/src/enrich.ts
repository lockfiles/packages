import { keyOf, type LockEntry, type Lockfile } from '@lockfiles/parse';
import { applyManifest } from './manifest.js';
import { readInstalled } from './node-modules.js';
import { applyProject } from './project.js';
import { fetchManifest, resolveRegistryOptions } from './registry.js';
import { Tracker } from './tracker.js';
import type { EnrichedField, EnrichOptions, EnrichReport } from './types.js';
import { describeError, pool } from './util.js';

/** Fields that are in the `package.json` of an installed package. */
const METADATA: readonly EnrichedField[] = [
  'license',
  'engines',
  'bin',
  'os',
  'cpu',
  'libc',
  'hasInstallScript',
];

/** Fields that only the registry knows. */
const REGISTRY_ONLY: readonly EnrichedField[] = ['integrity', 'resolved', 'deprecated'];

/** What each lockfile format doesn't store, see the table in the README of `@lockfiles/parse`. */
function wantedFields(lockfile: Lockfile): Set<EnrichedField> {
  switch (lockfile.kind) {
    case 'npm':
      return new Set();
    case 'pnpm':
      return new Set(['resolved', 'license', 'bin', 'hasInstallScript']);
    case 'bun':
      return new Set(['resolved', 'license', 'engines', 'hasInstallScript', 'deprecated']);
    case 'yarn':
      return new Set<EnrichedField>(
        lockfile.lockfileVersion === '1'
          ? ['license', 'engines', 'bin', 'os', 'cpu', 'libc', 'hasInstallScript', 'deprecated']
          : ['integrity', 'resolved', 'license', 'engines', 'hasInstallScript', 'deprecated'],
      );
  }
}

const isMissing = (entry: LockEntry, field: EnrichedField): boolean =>
  (entry as unknown as Record<string, unknown>)[field] === undefined;

/**
 * Fills in what the lockfile doesn't store. The lockfile is changed in place, and values that it already has are never replaced.
 *
 * It works in three steps:
 * 1. `project`: finds out which packages are dev or optional from the `package.json` files (yarn only).
 * 2. `nodeModules`: reads license, engines and more from installed packages.
 * 3. `registry`: asks the npm registry for what is still missing. This is off by default.
 *
 * @returns A report of what was filled, where it came from and what could not be found.
 */
export async function enrich(
  lockfile: Lockfile,
  options: EnrichOptions = {},
): Promise<EnrichReport> {
  const {
    projectDir = process.cwd(),
    project = true,
    nodeModules = true,
    registry = false,
  } = options;
  const tracker = new Tracker();
  const wanted = wantedFields(lockfile);
  const wantedMetadata = new Set(METADATA.filter((field) => wanted.has(field)));
  const needsMetadata = (entry: LockEntry): boolean =>
    [...wantedMetadata].some((field) => isMissing(entry, field));
  const needsRegistryOnly = (entry: LockEntry): boolean =>
    REGISTRY_ONLY.some((field) => wanted.has(field) && isMissing(entry, field));
  // Workspace, git and file packages are not on the registry.
  const isOnRegistry = (entry: LockEntry): boolean =>
    entry.source === undefined || entry.source === 'registry';

  if (project && lockfile.kind === 'yarn') await applyProject(lockfile, projectDir, tracker);

  const hasMetadata = new Set<LockEntry>();
  if (nodeModules && wantedMetadata.size > 0) {
    const candidates = lockfile.filter((entry) => isOnRegistry(entry) && needsMetadata(entry));
    const installed = await readInstalled(projectDir, candidates, 16);
    for (const [entry, { manifest, hasBindingGyp }] of installed) {
      applyManifest(tracker, entry, manifest, wantedMetadata, 'node_modules', { hasBindingGyp });
      hasMetadata.add(entry);
    }
  }

  if (registry) {
    const registryOptions = resolveRegistryOptions(registry);
    const targets = lockfile.filter(
      (entry) =>
        isOnRegistry(entry) &&
        (needsRegistryOnly(entry) || (!hasMetadata.has(entry) && needsMetadata(entry))),
    );
    await pool(targets, registryOptions.concurrency, async (entry) => {
      try {
        const manifest = await fetchManifest(entry.name, entry.version, registryOptions);
        if (manifest) applyManifest(tracker, entry, manifest, wanted, 'registry');
        else
          tracker.report.failed.push({ key: keyOf(entry.name, entry.version), error: 'not found' });
      } catch (error) {
        tracker.report.failed.push({
          key: keyOf(entry.name, entry.version),
          error: describeError(error),
        });
      }
    });
  }

  return tracker.report;
}
