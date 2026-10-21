import { parse } from 'yaml';
import { Lockfile, keyOf, type Source } from './lockfile.js';
import { asList, inferScopes, sourceOfUrl } from './util.js';

type Deps = Record<string, string>;

interface PnpmEntry {
  version?: string;
  resolution?: {
    integrity?: string;
    tarball?: string;
    type?: string;
    repo?: string;
    commit?: string;
    directory?: string;
  };
  engines?: Deps;
  os?: string[];
  cpu?: string[];
  libc?: string[];
  deprecated?: string;
  requiresBuild?: boolean;
  dev?: boolean;
  optional?: boolean;
  dependencies?: Deps;
  optionalDependencies?: Deps;
  peerDependencies?: Deps;
}

// v6+ importers list `{ specifier, version }` pairs; older files list plain versions.
type ImporterDeps = Record<string, string | { specifier?: string; version: string }>;

interface PnpmImporter {
  dependencies?: ImporterDeps;
  devDependencies?: ImporterDeps;
  optionalDependencies?: ImporterDeps;
}

interface PnpmLock extends PnpmImporter {
  lockfileVersion?: string | number;
  importers?: Record<string, PnpmImporter>;
  packages?: Record<string, PnpmEntry>;
  snapshots?: Record<string, PnpmEntry>;
}

const NUMERIC = /^\d/;

/** Splits a package or snapshot key into its name and spec; the spec is a version unless the package is not from a registry. */
function parseKey(rawKey: string): { name: string; spec: string } | undefined {
  const s = (rawKey.startsWith('/') ? rawKey.slice(1) : rawKey).replace(/\(.*$/, '');
  const at = s.indexOf('@', 1);
  if (at <= 0) return undefined;
  const spec = s.slice(at + 1);
  return {
    name: s.slice(0, at),
    spec: NUMERIC.test(spec) ? spec.split('_')[0]! : spec,
  };
}

function sourceOf(spec: string, resolution: PnpmEntry['resolution']): Source {
  if (NUMERIC.test(spec)) return 'registry';
  if (resolution?.type === 'git' || resolution?.repo) return 'git';
  if (resolution?.type === 'directory' || resolution?.directory) return 'file';
  return sourceOfUrl(spec);
}

export function parsePnpmLock(text: string): Lockfile {
  const doc = parse(text) as PnpmLock;
  if (!doc || typeof doc !== 'object' || doc.lockfileVersion === undefined) {
    throw new Error('Not a pnpm-lock.yaml: lockfileVersion is missing');
  }
  if (Number.parseFloat(String(doc.lockfileVersion)) < 6) {
    throw new Error(
      `pnpm-lock.yaml lockfileVersion ${doc.lockfileVersion} is not supported; use pnpm >= 8`,
    );
  }

  // `name@spec` as written in lockfile keys -> entry key (`name@version`).
  const keyBySpec = new Map<string, string>();
  const metas = new Map<string, PnpmEntry>();
  for (const [rawKey, info] of Object.entries(doc.packages ?? {})) {
    const id = parseKey(rawKey);
    const version = id && (NUMERIC.test(id.spec) ? id.spec : info.version);
    if (!id || !version) continue;
    keyBySpec.set(`${id.name}@${id.spec}`, keyOf(id.name, String(version)));
    metas.set(`${id.name}@${id.spec}`, info);
  }

  const resolveDependency = (depName: string, rawValue: string): string | undefined => {
    const value = String(rawValue).replace(/\(.*$/, '');
    if (value.startsWith('link:')) return undefined;
    if (NUMERIC.test(value)) return keyOf(depName, value.split('_')[0]!);
    // Aliases are written as `/name@version` (v6) or `name@version` (v9).
    const alias = value.startsWith('/') || value.indexOf('@', 1) > 0 ? parseKey(value) : undefined;
    if (alias && NUMERIC.test(alias.spec)) return keyOf(alias.name, alias.spec);
    return keyBySpec.get(alias ? `${alias.name}@${alias.spec}` : `${depName}@${value}`);
  };

  const lockfile = new Lockfile('pnpm');
  if (doc.lockfileVersion !== undefined) lockfile.lockfileVersion = String(doc.lockfileVersion);
  for (const [rawKey, info] of Object.entries(doc.snapshots ?? doc.packages ?? {})) {
    const id = parseKey(rawKey);
    if (!id) continue;
    const meta = metas.get(`${id.name}@${id.spec}`);
    const key = keyBySpec.get(`${id.name}@${id.spec}`);
    if (!key || !meta) continue;
    const version = key.slice(id.name.length + 1);

    const resolved = new Map<string, string>();
    const optionalDependencies = new Set<string>();
    for (const [depName, value] of Object.entries(info.dependencies ?? {})) {
      const target = resolveDependency(depName, value);
      if (target) resolved.set(depName, target);
    }
    for (const [depName, value] of Object.entries(info.optionalDependencies ?? {})) {
      const target = resolveDependency(depName, value);
      if (!target) continue;
      resolved.set(depName, target);
      optionalDependencies.add(target);
    }
    // pnpm resolves peers into the snapshot's dependencies.
    const peerDependencies = new Set<string>();
    for (const peer of Object.keys(meta.peerDependencies ?? {})) {
      const target = resolved.get(peer);
      if (target) peerDependencies.add(target);
    }

    const resolution = meta.resolution;
    lockfile.add(id.name, version, {
      integrity: resolution?.integrity,
      resolved:
        resolution?.tarball ??
        resolution?.directory ??
        (resolution?.repo ? `${resolution.repo}#${resolution.commit}` : undefined),
      source: sourceOf(id.spec, resolution),
      dev: meta.dev,
      optional: info.optional === true || meta.optional === true,
      engines: meta.engines,
      os: asList(meta.os),
      cpu: asList(meta.cpu),
      libc: asList(meta.libc),
      hasInstallScript: info.requiresBuild ?? meta.requiresBuild,
      deprecated: meta.deprecated,
      dependencies: resolved.values(),
      optionalDependencies,
      peerDependencies,
      ranges: meta.peerDependencies,
    });
  }

  const importers: Record<string, PnpmImporter> =
    doc.importers ??
    (doc.dependencies || doc.devDependencies || doc.optionalDependencies ? { '.': doc } : {});
  const resolveImporterDeps = (deps: ImporterDeps | undefined): Set<string> => {
    const keys = new Set<string>();
    for (const [depName, value] of Object.entries(deps ?? {})) {
      const target = resolveDependency(depName, typeof value === 'string' ? value : value.version);
      if (target) keys.add(target);
    }
    return keys;
  };
  for (const [importerPath, info] of Object.entries(importers)) {
    const importer = lockfile.importer(importerPath === '.' ? '' : importerPath);
    importer.dependencies = resolveImporterDeps(info.dependencies);
    importer.devDependencies = resolveImporterDeps(info.devDependencies);
    importer.optionalDependencies = resolveImporterDeps(info.optionalDependencies);
  }

  inferScopes(lockfile);
  return lockfile;
}
