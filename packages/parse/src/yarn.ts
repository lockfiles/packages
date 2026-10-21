import { parse as parseYaml } from 'yaml';
import { Lockfile, keyOf, type Source } from './lockfile.js';
import { asBin, sourceOfUrl } from './util.js';

type Deps = Record<string, string>;

interface YarnEntry {
  version?: string;
  resolved?: string;
  integrity?: string;
  resolution?: string;
  checksum?: string;
  bin?: unknown;
  conditions?: string;
  dependencies?: Deps;
  optionalDependencies?: Deps;
  dependenciesMeta?: Record<string, { optional?: boolean }>;
}

const nameOfDescriptor = (descriptor: string): string =>
  descriptor.slice(0, descriptor.indexOf('@', 1));

function link(
  lockfile: Lockfile,
  entries: [string, YarnEntry][],
  keyByDescriptor: Map<string, string>,
  candidates: (name: string, range: string) => string[],
): void {
  const resolve = (name: string, range: string): string | undefined =>
    candidates(name, range)
      .map((c) => keyByDescriptor.get(c))
      .find(Boolean);

  for (const [descriptor, key] of keyByDescriptor) lockfile.descriptors.set(descriptor, key);
  for (const [descriptor, info] of entries) {
    const self = keyByDescriptor.get(descriptor);
    if (!self || !info.version) continue;
    const { dependencies, optionalDependencies } = resolveDependencies(info, resolve);
    lockfile.add(nameOfDescriptor(descriptor), info.version, {
      dependencies,
      optionalDependencies,
      ranges: { ...info.dependencies, ...info.optionalDependencies },
    });
  }
}

function resolveDependencies(
  info: YarnEntry,
  resolve: (name: string, range: string) => string | undefined,
): { dependencies: Set<string>; optionalDependencies: Set<string> } {
  const dependencies = new Set<string>();
  const optionalDependencies = new Set<string>();
  const add = (deps: Deps | undefined, optional: (name: string) => boolean): void => {
    for (const [dep, range] of Object.entries(deps ?? {})) {
      const target = resolve(dep, range);
      if (!target) continue;
      dependencies.add(target);
      if (optional(dep)) optionalDependencies.add(target);
    }
  };
  // Berry lists optional dependencies as regular ones and flags them in `dependenciesMeta`.
  add(info.dependencies, (name) => info.dependenciesMeta?.[name]?.optional === true);
  add(info.optionalDependencies, () => true);
  return { dependencies, optionalDependencies };
}

const QUOTED = String.raw`"(?:[^"\\]|\\.)*"`;
const DESCRIPTOR = new RegExp(`${QUOTED}|[^\\s,]+`, 'g');
const SECTION = new RegExp(`^(${QUOTED}|[^\\s:]+):$`);
const FIELD = new RegExp(`^(${QUOTED}|\\S+)\\s+(.*)$`);
const unquote = (value: string): string => (value.startsWith('"') ? JSON.parse(value) : value);

/** Parses the yarn v1 format: `descriptor, descriptor:` headers followed by indented `key value` lines and `key:` sections. */
function parseClassicText(text: string): Record<string, YarnEntry> {
  const entries: Record<string, YarnEntry> = {};
  let entry: Record<string, unknown> | undefined;
  let section: Deps | undefined;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const indent = rawLine.length - rawLine.trimStart().length;

    if (indent === 0) {
      entry = {};
      section = undefined;
      for (const [descriptor] of line.replace(/:$/, '').matchAll(DESCRIPTOR)) {
        entries[unquote(descriptor)] = entry as YarnEntry;
      }
    } else if (!entry) {
      throw new Error('yarn.lock is not valid: found a field outside of an entry');
    } else if (indent === 2) {
      const sectionName = SECTION.exec(line)?.[1];
      if (sectionName) {
        section = {};
        entry[unquote(sectionName)] = section;
        continue;
      }
      const [, key, value] = FIELD.exec(line) ?? [];
      if (key && value !== undefined) entry[unquote(key)] = unquote(value);
    } else if (section) {
      const [, name, range] = FIELD.exec(line) ?? [];
      if (name && range !== undefined) section[unquote(name)] = unquote(range);
    }
  }
  return entries;
}

function parseClassic(text: string): Lockfile {
  const object = parseClassicText(text);
  const lockfile = new Lockfile('yarn');
  lockfile.lockfileVersion = '1';
  const keyByDescriptor = new Map<string, string>();
  const entries = Object.entries(object);
  for (const [descriptor, info] of entries) {
    if (!info.version) continue;
    const name = nameOfDescriptor(descriptor);
    keyByDescriptor.set(descriptor, keyOf(name, info.version));
    lockfile.add(name, info.version, {
      integrity: info.integrity,
      resolved: info.resolved,
      source: info.resolved
        ? sourceOfUrl(info.resolved, { name, version: info.version })
        : undefined,
    });
  }
  link(lockfile, entries, keyByDescriptor, (name, range) => [`${name}@${range}`]);
  return lockfile;
}

/** Returns undefined for entries that are not installed packages (patches, links, generated). */
function berrySource(spec: string): Source | undefined {
  if (spec.startsWith('npm:')) return 'registry';
  if (/^(?:patch|portal|link|exec):/.test(spec)) return undefined;
  return sourceOfUrl(spec);
}

// Berry encodes platform restrictions as `os=darwin & cpu=arm64`.
function parseConditions(conditions: string | undefined): {
  os?: string[];
  cpu?: string[];
  libc?: string[];
} {
  const result: Record<string, string[]> = {};
  for (const [, field, value] of (conditions ?? '').matchAll(/\b(os|cpu|libc)=([^\s&|]+)/g)) {
    (result[field!] ??= []).push(value!);
  }
  return result;
}

function parseBerry(text: string): Lockfile {
  const doc = parseYaml(text) as Record<string, YarnEntry>;
  const lockfile = new Lockfile('yarn');
  const metadata = doc.__metadata as { version?: number | string } | undefined;
  if (metadata?.version !== undefined) lockfile.lockfileVersion = String(metadata.version);
  const keyByDescriptor = new Map<string, string>();
  const entries: [string, YarnEntry][] = [];
  const workspaces: [string, YarnEntry][] = [];
  for (const [descriptors, info] of Object.entries(doc)) {
    if (descriptors === '__metadata' || !info.version || !info.resolution) continue;
    const name = nameOfDescriptor(info.resolution);
    const spec = info.resolution.slice(name.length + 1);
    if (spec.startsWith('workspace:')) {
      workspaces.push([descriptors, info]);
      continue;
    }
    const source = berrySource(spec);
    if (!source) continue;
    for (const descriptor of descriptors.split(',').map((d) => d.trim())) {
      keyByDescriptor.set(descriptor, keyOf(name, info.version));
      entries.push([descriptor, info]);
    }
    lockfile.add(name, info.version, {
      checksum: info.checksum,
      resolved: source === 'registry' ? undefined : spec,
      source,
      bin: asBin(info.bin, name),
      ...parseConditions(info.conditions),
    });
  }
  const candidates = (name: string, range: string): string[] => [
    `${name}@${range}`,
    `${name}@npm:${range}`,
  ];
  link(lockfile, entries, keyByDescriptor, candidates);

  for (const [, info] of workspaces) {
    const name = nameOfDescriptor(info.resolution!);
    const workspacePath = info.resolution!.slice(name.length + '@workspace:'.length);
    const importer = lockfile.importer(workspacePath === '.' ? '' : workspacePath);
    importer.name = name;
    if (!info.version!.startsWith('0.0.0-use.local')) importer.version = info.version;
    const { dependencies, optionalDependencies } = resolveDependencies(info, (dep, range) =>
      candidates(dep, range)
        .map((c) => keyByDescriptor.get(c))
        .find(Boolean),
    );
    for (const key of optionalDependencies) dependencies.delete(key);
    importer.dependencies = dependencies;
    importer.optionalDependencies = optionalDependencies;
  }
  return lockfile;
}

export function parseYarnLock(text: string): Lockfile {
  return /^__metadata:/m.test(text) ? parseBerry(text) : parseClassic(text);
}
