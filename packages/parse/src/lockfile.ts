/** Where a package comes from. `workspace` means a local package of the project. */
export type Source = 'registry' | 'git' | 'tarball' | 'file' | 'workspace';

export interface LockEntry {
  /** Package name, e.g. `react` or `@scope/pkg`. */
  name: string;
  /** Exact installed version. */
  version: string;
  /** Integrity hash of the package tarball (SRI format, e.g. `sha512-...`). */
  integrity?: string;
  /** Checksum of the package archive. Only in yarn berry. It is not an SRI hash! */
  checksum?: string;
  /** URL or path the package was resolved from. */
  resolved?: string;
  /** Where the package comes from. */
  source?: Source;
  /** `true` if the package is only used through dev dependencies. Not available for yarn. */
  dev?: boolean;
  /** `true` if the package is only used through optional dependencies. Not available for yarn. */
  optional?: boolean;
  /** `true` if the package is only used through peer dependencies. Only available for npm. */
  peer?: boolean;
  /** License of the package, e.g. `MIT`. */
  license?: string;
  /** Executables of the package. Maps the command name to the file path. */
  bin?: Record<string, string>;
  /** Required versions of the runtime, e.g. `{ node: ">=18" }`. */
  engines?: Record<string, string>;
  /** Operating systems the package works on, e.g. `["darwin"]`. */
  os?: string[];
  /** CPU architectures the package works on, e.g. `["arm64"]`. */
  cpu?: string[];
  /** C libraries the package works with, e.g. `["glibc"]`. */
  libc?: string[];
  /** `true` if the package runs a script when it is installed. */
  hasInstallScript?: boolean;
  /** Message from the author if the package is deprecated. */
  deprecated?: string;
  /** Keys (`name@version`) of all packages this package depends on. This includes optional and peer dependencies. */
  dependencies: Set<string>;
  /** Keys of the optional dependencies. These are also in `dependencies`. */
  optionalDependencies: Set<string>;
  /** Keys of the peer dependencies. These are also in `dependencies`. Not available for yarn. */
  peerDependencies: Set<string>;
  /** The version range that was requested for each dependency, by name. Not available for pnpm. */
  ranges: Record<string, string>;
}

/** The root project or a workspace package. */
export interface Importer {
  /** Path relative to the lockfile. It is empty for the root project. */
  path: string;
  /** Package name from the `package.json`, if the lockfile has it. */
  name?: string;
  /** Package version from the `package.json`, if the lockfile has it. */
  version?: string;
  /** Keys (`name@version`) of the dependencies. Yarn does not keep dev dependencies apart, so they are also here. */
  dependencies: Set<string>;
  /** Keys of the dev dependencies. */
  devDependencies: Set<string>;
  /** Keys of the optional dependencies. */
  optionalDependencies: Set<string>;
  /** Keys of the peer dependencies. */
  peerDependencies: Set<string>;
}

export type LockEntryExtra = Partial<
  Omit<LockEntry, 'name' | 'version' | 'dependencies' | 'optionalDependencies' | 'peerDependencies'>
> & {
  dependencies?: Iterable<string>;
  optionalDependencies?: Iterable<string>;
  peerDependencies?: Iterable<string>;
};

export type PackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun';

/**
 * What kind of dependency a package is.
 * A package can have more than one kind, e.g. a dev package that is also optional. `prod` means none of the others.
 */
export type DependencyType = 'prod' | 'dev' | 'optional' | 'peer';

/** Set a type to `false` to leave out the packages of that type. Every type defaults to `true`. */
export type GetAllOptions = Partial<Record<DependencyType, boolean>>;

/** `T` with every `Set<string>` turned into a `string[]`. */
type Serialized<T> = { [K in keyof T]: T[K] extends Set<string> ? string[] : T[K] };

/** What `Lockfile.toJSON()` returns. Sets become arrays and maps become objects. */
export interface LockfileJSON {
  kind: PackageManager;
  lockfileVersion?: string;
  /** Keyed by `name@version`. */
  entries: Record<string, Serialized<LockEntry>>;
  /** Keyed by path. */
  importers: Record<string, Serialized<Importer>>;
}

export interface TraverseOptions {
  /** Where to start. By default, everything the importers depend on. The start entries are included. */
  from?: Iterable<LockEntry>;
  /** Follow the dev dependencies of the importers. Defaults to `true`. */
  dev?: boolean;
  /** Follow optional dependencies. Defaults to `true`. */
  optional?: boolean;
}

const serialize = <T extends object>(value: T): Serialized<T> =>
  Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, item instanceof Set ? [...item] : item]),
  ) as Serialized<T>;

export const keyOf = (name: string, version: string): string => `${name}@${version}`;

// A package is only dev/optional/peer if every occurrence is.
const both = (a?: boolean, b?: boolean): boolean | undefined =>
  a === undefined ? b : b === undefined ? a : a && b;

export class Lockfile {
  /** All packages, keyed by `name@version`. */
  readonly entries = new Map<string, LockEntry>();
  /** The root project and its workspace packages, keyed by path. The root has the key `''`. */
  readonly importers = new Map<string, Importer>();
  /** Yarn only. Maps each descriptor of the lockfile (`name@range`) to the key of the entry it resolved to. */
  readonly descriptors = new Map<string, string>();
  /** Version of the lockfile format, if the lockfile has one. */
  lockfileVersion?: string;

  /** Reverse of `dependencies`. It is built when needed and reset when an entry is added. */
  #dependents?: Map<string, LockEntry[]>;

  /** @param kind The package manager that wrote the lockfile. */
  constructor(readonly kind: PackageManager) {}

  add(name: string, version: string, extra: LockEntryExtra = {}): LockEntry {
    this.#dependents = undefined;
    const key = keyOf(name, version);
    let entry = this.entries.get(key);
    if (!entry) {
      entry = {
        name,
        version,
        dependencies: new Set(),
        optionalDependencies: new Set(),
        peerDependencies: new Set(),
        ranges: {},
      };
      this.entries.set(key, entry);
    }
    const {
      dependencies,
      optionalDependencies,
      peerDependencies,
      ranges,
      dev,
      optional,
      peer,
      ...scalars
    } = extra;
    const target = entry as unknown as Record<string, unknown>;
    for (const [field, value] of Object.entries(scalars)) {
      if (value !== undefined) target[field] ??= value;
    }
    entry.dev = both(entry.dev, dev);
    entry.optional = both(entry.optional, optional);
    entry.peer = both(entry.peer, peer);
    for (const dep of dependencies ?? []) entry.dependencies.add(dep);
    for (const dep of optionalDependencies ?? []) entry.optionalDependencies.add(dep);
    for (const dep of peerDependencies ?? []) entry.peerDependencies.add(dep);
    for (const [dep, range] of Object.entries(ranges ?? {})) entry.ranges[dep] ??= range;
    return entry;
  }

  importer(path: string): Importer {
    let importer = this.importers.get(path);
    if (!importer) {
      importer = {
        path,
        dependencies: new Set(),
        devDependencies: new Set(),
        optionalDependencies: new Set(),
        peerDependencies: new Set(),
      };
      this.importers.set(path, importer);
    }
    return importer;
  }

  /**
   * Returns the package that a requested version range was resolved to, for example `react` and `^18.0.0`.
   * Only yarn lockfiles store this, so it returns `undefined` for all other package managers.
   */
  resolve(name: string, range: string): LockEntry | undefined {
    const key =
      this.descriptors.get(`${name}@${range}`) ?? this.descriptors.get(`${name}@npm:${range}`);
    return key ? this.entries.get(key) : undefined;
  }

  /**
   * Returns the package with this name and version, or `undefined`.
   *
   * @param name The name of the package.
   * @param version The version of the package.
   * @returns The lock entry for the specified package name and version, or `undefined` if it does not exist.
   */
  get(name: string, version: string): LockEntry | undefined {
    return this.entries.get(keyOf(name, version));
  }

  /**
   * Returns all entries of a package, one for each version.
   *
   * @param name The name of the package.
   * @returns An array of all entries for the specified package name.
   */
  entriesOf(name: string): LockEntry[] {
    return this.filter((e) => e.name === name);
  }

  /**
   * Returns all versions of a package.
   *
   * @param name The name of the package.
   * @returns An array of all versions for the specified package name.
   */
  versionsOf(name: string): string[] {
    return this.filter((e) => e.name === name).map((e) => e.version);
  }

  /** Number of packages in the lockfile. */
  get size(): number {
    return this.entries.size;
  }

  [Symbol.iterator](): IterableIterator<LockEntry> {
    return this.entries.values();
  }

  /** Returns all packages for which `predicate` is true. */
  filter(predicate: (entry: LockEntry) => unknown): LockEntry[] {
    return [...this.entries.values()].filter(predicate);
  }

  /**
   * Returns all packages. Set a type to `false` to leave out the packages of that type.
   * A package is left out if it has any of the types that are `false`.
   * For example, `getAll({ dev: false, optional: false })` returns what a production install needs.
   *
   * **Note:** All yarn packages count as `prod`.
   */
  getAll(options: GetAllOptions = {}): LockEntry[] {
    const { prod = true, dev = true, optional = true, peer = true } = options;
    return this.filter((entry) => {
      const isOtherType = entry.dev || entry.optional || entry.peer;
      if (!prod && !isOtherType) return false;
      return !((!dev && entry.dev) || (!optional && entry.optional) || (!peer && entry.peer));
    });
  }

  /** Returns the packages that `entry` depends on. Dependencies that are not in the lockfile are left out. */
  dependenciesOf(entry: LockEntry): LockEntry[] {
    return [...entry.dependencies].flatMap((key) => this.entries.get(key) ?? []);
  }

  /** Returns the packages that depend on the given package. */
  dependentsOf(name: string, version: string): LockEntry[] {
    if (!this.#dependents) {
      this.#dependents = new Map();
      for (const entry of this.entries.values()) {
        for (const key of entry.dependencies) {
          const list = this.#dependents.get(key);
          if (list) list.push(entry);
          else this.#dependents.set(key, [entry]);
        }
      }
    }
    return this.#dependents.get(keyOf(name, version)) ?? [];
  }

  /**
   * Visits every package that can be reached from the start, once each. The order is not defined.
   * Without `from` it starts at the dependencies of the importers, so it finds nothing for yarn classic.
   */
  *traverse(options: TraverseOptions = {}): Generator<LockEntry> {
    const { dev = true, optional = true } = options;
    const stack = [...(options.from ?? this.#directDependencies(dev, optional))];
    const seen = new Set<LockEntry>();
    for (let entry = stack.pop(); entry; entry = stack.pop()) {
      if (seen.has(entry)) continue;
      seen.add(entry);
      yield entry;
      for (const key of entry.dependencies) {
        if (!optional && entry.optionalDependencies.has(key)) continue;
        const dependency = this.entries.get(key);
        if (dependency) stack.push(dependency);
      }
    }
  }

  /** Returns the packages with the same name that are installed in more than one version. */
  duplicates(): Map<string, LockEntry[]> {
    const byName = new Map<string, LockEntry[]>();
    for (const entry of this.entries.values()) {
      const list = byName.get(entry.name);
      if (list) list.push(entry);
      else byName.set(entry.name, [entry]);
    }
    return new Map([...byName].filter(([, list]) => list.length > 1));
  }

  /**
   * Explains why a package is installed. Returns the chains of packages that lead to it.
   * Each chain starts with a package an importer depends on and ends with the given package.
   * The shortest chains come first. The result is empty if the package is missing or if there are no importers (yarn classic).
   *
   * @param options.limit The most chains to return. Defaults to `50`.
   */
  why(name: string, version: string, options: { limit?: number } = {}): LockEntry[][] {
    const { limit = 50 } = options;
    const target = this.get(name, version);
    if (!target) return [];

    const roots = new Set(this.#directDependencies(true, true));
    const chains: LockEntry[][] = [];
    const queue: LockEntry[][] = [[target]];
    for (let i = 0; i < queue.length && chains.length < limit; i++) {
      const path = queue[i]!;
      const head = path[path.length - 1]!;
      if (roots.has(head)) chains.push([...path].reverse());
      for (const parent of this.dependentsOf(head.name, head.version)) {
        if (!path.includes(parent)) queue.push([...path, parent]);
      }
    }
    return chains;
  }

  /** Returns a plain data representation that `JSON.stringify` can handle. */
  toJSON(): LockfileJSON {
    return {
      kind: this.kind,
      lockfileVersion: this.lockfileVersion,
      entries: Object.fromEntries([...this.entries].map(([key, entry]) => [key, serialize(entry)])),
      importers: Object.fromEntries(
        [...this.importers].map(([path, importer]) => [path, serialize(importer)]),
      ),
    };
  }

  #directDependencies(dev: boolean, optional: boolean): LockEntry[] {
    const keys = new Set<string>();
    for (const importer of this.importers.values()) {
      for (const key of importer.dependencies) keys.add(key);
      for (const key of importer.peerDependencies) keys.add(key);
      if (dev) for (const key of importer.devDependencies) keys.add(key);
      if (optional) for (const key of importer.optionalDependencies) keys.add(key);
    }
    return [...keys].flatMap((key) => this.entries.get(key) ?? []);
  }
}
