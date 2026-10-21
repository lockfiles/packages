import { parse } from 'yaml';
import { Lockfile, keyOf } from './lockfile.js';
import { asBin, asList, inferScopes } from './util.js';

type Deps = Record<string, string>;

interface BunInfo {
  dependencies?: Deps;
  optionalDependencies?: Deps;
  peerDependencies?: Deps;
  optionalPeers?: string[];
  bin?: unknown;
  os?: string | string[];
  cpu?: string | string[];
  libc?: string | string[];
}

interface BunWorkspace {
  name?: string;
  version?: string;
  dependencies?: Deps;
  devDependencies?: Deps;
  optionalDependencies?: Deps;
  peerDependencies?: Deps;
}

// npm packages are [ident, registry, info, integrity]; other kinds drop the registry slot, workspaces are just [ident].
// `ident` is `name@version` for registry packages.
type BunPackage = [string, ...unknown[]];

function identify(ident: string): { name: string; version: string } | undefined {
  const at = ident.indexOf('@', 1);
  if (at <= 0) return undefined;
  const spec = ident.slice(at + 1);
  if (spec.startsWith('npm:')) return identify(spec.slice(4));
  return /^\d/.test(spec) ? { name: ident.slice(0, at), version: spec } : undefined;
}

const infoOf = (pkg: BunPackage): BunInfo =>
  (pkg.slice(1, 3).find((x) => x && typeof x === 'object' && !Array.isArray(x)) as
    | BunInfo
    | undefined) ?? {};

/** Splits a lockfile key such as `@scope/a/b` into its package segments `@scope/a`, `b`. */
function segments(key: string): string[] {
  const parts = key.split('/');
  const result: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    result.push(
      parts[i]!.startsWith('@') && i + 1 < parts.length ? `${parts[i]}/${parts[++i]}` : parts[i]!,
    );
  }
  return result;
}

export function parseBunLock(text: string): Lockfile {
  // The file is JSONC with trailing commas, which YAML flow syntax accepts.
  const doc = parse(text) as {
    lockfileVersion?: number;
    workspaces?: Record<string, BunWorkspace>;
    packages?: Record<string, BunPackage>;
  };
  if (!doc?.packages) throw new Error('bun.lock has no packages section');

  const keyByPath = new Map<string, string>();
  for (const [lockKey, pkg] of Object.entries(doc.packages)) {
    const id = identify(pkg[0]);
    if (id) keyByPath.set(lockKey, keyOf(id.name, id.version));
  }

  // Nested entries are keyed `parent/dep`; fall back through each ancestor like Node resolution.
  const resolve = (parent: string[], dep: string): string | undefined => {
    for (let base = parent; ; base = base.slice(0, -1)) {
      const target = keyByPath.get([...base, dep].join('/'));
      if (target) return target;
      if (base.length === 0) return undefined;
    }
  };
  const resolveAll = (parent: string[], names: Iterable<string>): Set<string> => {
    const keys = new Set<string>();
    for (const dep of names) {
      const key = resolve(parent, dep);
      if (key) keys.add(key);
    }
    return keys;
  };

  const lockfile = new Lockfile('bun');
  if (doc.lockfileVersion !== undefined) lockfile.lockfileVersion = String(doc.lockfileVersion);
  for (const [lockKey, pkg] of Object.entries(doc.packages)) {
    const id = identify(pkg[0]);
    if (!id) continue;
    const info = infoOf(pkg);
    const parent = segments(lockKey);
    const optionalDependencies = resolveAll(parent, [
      ...Object.keys(info.optionalDependencies ?? {}),
      ...(info.optionalPeers ?? []),
    ]);
    const peerDependencies = resolveAll(parent, Object.keys(info.peerDependencies ?? {}));
    const integrity = typeof pkg[3] === 'string' && pkg[3].startsWith('sha') ? pkg[3] : undefined;
    lockfile.add(id.name, id.version, {
      integrity,
      source: 'registry',
      bin: asBin(info.bin, id.name),
      os: asList(info.os),
      cpu: asList(info.cpu),
      libc: asList(info.libc),
      dependencies: new Set([
        ...resolveAll(parent, Object.keys(info.dependencies ?? {})),
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

  for (const [workspacePath, workspace] of Object.entries(doc.workspaces ?? {})) {
    const importer = lockfile.importer(workspacePath);
    importer.name = workspace.name;
    importer.version = workspace.version;
    // Workspace packages own their nested entries under their name; the root's live at the top level.
    const parent = workspacePath && workspace.name ? [workspace.name] : [];
    importer.dependencies = resolveAll(parent, Object.keys(workspace.dependencies ?? {}));
    importer.devDependencies = resolveAll(parent, Object.keys(workspace.devDependencies ?? {}));
    importer.optionalDependencies = resolveAll(
      parent,
      Object.keys(workspace.optionalDependencies ?? {}),
    );
    importer.peerDependencies = resolveAll(parent, Object.keys(workspace.peerDependencies ?? {}));
  }

  inferScopes(lockfile);
  return lockfile;
}
