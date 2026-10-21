import { Lockfile, keyOf, type Source } from './lockfile.js';
import { asBin, asLicense, asList, sourceOfUrl } from './util.js';

type Deps = Record<string, string>;

interface NpmPackageEntry {
  name?: string;
  version?: string;
  resolved?: string;
  integrity?: string;
  link?: boolean;
  dev?: boolean;
  optional?: boolean;
  devOptional?: boolean;
  peer?: boolean;
  license?: unknown;
  bin?: unknown;
  engines?: Deps | string[];
  os?: string | string[];
  cpu?: string | string[];
  libc?: string | string[];
  hasInstallScript?: boolean;
  deprecated?: string;
  dependencies?: Deps;
  devDependencies?: Deps;
  optionalDependencies?: Deps;
  peerDependencies?: Deps;
}

const LAST_PACKAGE_SEGMENT = /(?:^|\/)node_modules\/(?:@[^/]+\/)?[^/]+$/;

const isInstalled = (pkgPath: string): boolean => pkgPath.includes('node_modules/');

function sourceOf(pkgPath: string, info: NpmPackageEntry, name: string): Source | undefined {
  if (!isInstalled(pkgPath)) return 'workspace';
  if (!info.resolved) return undefined;
  return sourceOfUrl(info.resolved, info.version ? { name, version: info.version } : undefined);
}

export function parseNpmLock(text: string): Lockfile {
  const json = JSON.parse(text) as {
    lockfileVersion?: number;
    packages?: Record<string, NpmPackageEntry>;
  };
  if (!json.packages)
    throw new Error(
      'package-lock.json lockfileVersion 1 is not supported; regenerate it with npm >= 7',
    );

  const lockfile = new Lockfile('npm');
  if (json.lockfileVersion !== undefined) lockfile.lockfileVersion = String(json.lockfileVersion);
  const keyByPath = new Map<string, string>();
  for (const [pkgPath, info] of Object.entries(json.packages)) {
    if (!pkgPath || info.link) continue;
    const name =
      info.name ?? pkgPath.slice(pkgPath.lastIndexOf('node_modules/') + 'node_modules/'.length);
    if (!name || !info.version) continue;
    keyByPath.set(pkgPath, keyOf(name, info.version));
  }

  // Node resolution: look in own node_modules, then in each ancestor's.
  // Workspace paths such as `packages/app` have no node_modules segment and go straight to the root.
  const resolve = (pkgPath: string, dep: string): string | undefined => {
    let base = pkgPath;
    for (;;) {
      const target = keyByPath.get(`${base ? `${base}/` : ''}node_modules/${dep}`);
      if (target) return target;
      if (!base) return undefined;
      const parent = base.replace(LAST_PACKAGE_SEGMENT, '');
      base = parent === base ? '' : parent;
    }
  };
  const resolveAll = (pkgPath: string, deps: Deps | undefined): Set<string> => {
    const keys = new Set<string>();
    for (const dep of Object.keys(deps ?? {})) {
      const key = resolve(pkgPath, dep);
      if (key) keys.add(key);
    }
    return keys;
  };

  for (const [pkgPath, info] of Object.entries(json.packages)) {
    const key = keyByPath.get(pkgPath);
    if (!key || !info.version) continue;
    const name = key.slice(0, key.length - info.version.length - 1);
    const optionalDependencies = resolveAll(pkgPath, info.optionalDependencies);
    const peerDependencies = resolveAll(pkgPath, info.peerDependencies);
    lockfile.add(name, info.version, {
      integrity: info.integrity,
      resolved: info.resolved,
      source: sourceOf(pkgPath, info, name),
      dev: info.dev === true || info.devOptional === true,
      optional: info.optional === true || info.devOptional === true,
      peer: info.peer === true,
      license: asLicense(info.license),
      bin: asBin(info.bin, name),
      engines: Array.isArray(info.engines) ? undefined : info.engines,
      os: asList(info.os),
      cpu: asList(info.cpu),
      libc: asList(info.libc),
      hasInstallScript: info.hasInstallScript,
      deprecated: info.deprecated,
      dependencies: new Set([
        ...resolveAll(pkgPath, info.dependencies),
        ...optionalDependencies,
        ...peerDependencies,
      ]),
      optionalDependencies,
      peerDependencies,
      ranges: {
        ...info.peerDependencies,
        ...info.optionalDependencies,
        ...info.dependencies,
      },
    });
  }

  for (const [pkgPath, info] of Object.entries(json.packages)) {
    if (info.link || isInstalled(pkgPath)) continue;
    const importer = lockfile.importer(pkgPath);
    importer.name = info.name;
    importer.version = info.version;
    importer.dependencies = resolveAll(pkgPath, info.dependencies);
    importer.devDependencies = resolveAll(pkgPath, info.devDependencies);
    importer.optionalDependencies = resolveAll(pkgPath, info.optionalDependencies);
    importer.peerDependencies = resolveAll(pkgPath, info.peerDependencies);
  }
  return lockfile;
}
