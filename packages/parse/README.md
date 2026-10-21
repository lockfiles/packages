# @lockfiles/parse

A small, single dependency library written in typescript for parsing **lockfiles of any js package manager**. Put in a path and get the parsed lockfile data. No matter which package manager you use, it just works.

## Quick Guide

### Installation

```bash
npm i @lockfiles/parse
```

### Usage

```ts
import { parseLockfile } from '@lockfiles/parse';

// From a path
const lockfile = await parseLockfile('./package-lock.json');

const entry = lockfile.get('react', '19.0.0');
console.log(entry?.integrity, entry?.dependencies);
```

## Supported Lock Files

| Package Manager | Lock File                                   | Version                                     |
| --------------- | ------------------------------------------- | ------------------------------------------- |
| npm             | `package-lock.json` / `npm-shrinkwrap.json` | `lockfileVersion` 2 and 3 (npm >= 7)        |
| pnpm            | `pnpm-lock.yaml`                            | `lockfileVersion` 6 and 9 (pnpm >= 8)       |
| yarn classic    | `yarn.lock`                                 | v1                                          |
| yarn berry      | `yarn.lock`                                 | any (tested with `__metadata` version 10)   |
| bun             | `bun.lock`                                  | any (tested with `lockfileVersion` 1 and 2) |

## API

### Functions

#### `parseLockfile(input: string): Promise<Lockfile>`

Results in a parsed lockfile. `input` is either the path to a lockfile or the content of one.

```ts
const lockfile = await parseLockfile('./package-lock.json');
```

#### `parseLockfileSync(input: string): Lockfile`

Same as `parseLockfile`, but synchronous. It throws if the file can't be read.

#### `findLockfile(startDir?: string, options?: { searchParents?: boolean }): Promise<string | undefined>`

Looks for a lockfile in `startDir` and returns its absolute path, or `undefined` if there is none. `startDir` defaults to current working directory (`process.cwd()`).

Set `searchParents: true` to increase the search in the parent directories. Might be helpful for monorepos.
Hits in order: `package-lock.json`, `npm-shrinkwrap.json`, `pnpm-lock.yaml`, `yarn.lock`, `bun.lock`.

```ts
const file = await findLockfile(process.cwd(), { searchParents: true });
const lockfile = file && (await parseLockfile(file));
```

#### `findLockfileSync(startDir?: string, options?: { searchParents?: boolean }): string | undefined`

Same as `findLockfile`, but synchronous.

#### `findAndParseLock(startDir?: string, options?: { searchParents?: boolean }): Promise<Lockfile | undefined>`

Finds a lockfile with `findLockfile` and parses it with `parseLockfile`. It takes the same arguments as `findLockfile`. It returns `undefined` if there is no lockfile.

```ts
const lockfile = await findAndParseLock(process.cwd(), { searchParents: true });
```

#### `findAndParseLockSync(startDir?: string, options?: { searchParents?: boolean }): Lockfile | undefined`

Same as `findAndParseLock`, but synchronous.

#### `inferScopes(lockfile: Lockfile): void`

Fills `dev` and `optional` of the packages that have no value, by following the dependencies from the `importers`. It does nothing if there are no importers. `parseLockfile` already uses it for the lockfiles that need it. Use it yourself after you added importers, like [`@lockfiles/enrich`](../enrich) does for yarn.

### `Lockfile`

The result of `parseLockfile`.

| Member                 | Type                                 | Description                                                                 |
| ---------------------- | ------------------------------------ | --------------------------------------------------------------------------- |
| `kind`                 | `"npm" \| "pnpm" \| "yarn" \| "bun"` | The package manager of the lockfile                                         |
| `lockfileVersion`      | `string \| undefined`                | The version of the lockfile format                                          |
| `entries`              | `Map<string, LockEntry>`             | All packages, keyed by `name@version`                                       |
| `importers`            | `Map<string, Importer>`              | The project and its workspace packages, keyed by path. The root key is `''` |
| `get(name, version)`   | `LockEntry \| undefined`             | One package by name and version                                             |
| `entriesOf(name)`      | `LockEntry[]`                        | All entries of a package, one for each version                              |
| `versionsOf(name)`     | `string[]`                           | All versions of a package                                                   |
| `descriptors`          | `Map<string, string>`                | Yarn only. Maps each requested `name@range` to the `name@version` it got    |
| `resolve(name, range)` | `LockEntry \| undefined`             | Yarn only. The package that a requested range was resolved to               |

#### Working with the dependency graph

| Member                          | Returns                    | Description                                               |
| ------------------------------- | -------------------------- | --------------------------------------------------------- |
| `lockfile.size`                 | `number`                   | Number of packages                                        |
| `for (const entry of lockfile)` | `LockEntry`                | Loops over all packages                                   |
| `filter(predicate)`             | `LockEntry[]`              | All packages for which `predicate` is true                |
| `getAll(options?)`              | `LockEntry[]`              | All packages, except the types set to `false` (see below) |
| `dependenciesOf(entry)`         | `LockEntry[]`              | All packages that `entry` depends on                      |
| `dependentsOf(name, version)`   | `LockEntry[]`              | All packages that depend on this package                  |
| `traverse(options?)`            | `Generator<LockEntry>`     | Generator returning every package that can be reached     |
| `duplicates()`                  | `Map<string, LockEntry[]>` | Packages that are installed in more than one version      |
| `why(name, version, options?)`  | `LockEntry[][]`            | Why a package is installed                                |
| `toJSON()`                      | `LockfileJSON`             | Plain data in JSON format                                 |

```ts
const lockfile = await parseLockfile('./package-lock.json');

for (const chain of lockfile.why('js-tokens', '4.0.0')) {
  console.log(chain.map((entry) => entry.name).join(' > '));
}
// react > loose-envify > js-tokens
// react-dom > loose-envify > js-tokens
// react-dom > react > loose-envify > js-tokens
// react-dom > scheduler > loose-envify > js-tokens
```

`getAll` returns all dependencies. Leave out types `prod`, `dev`, `optional` and `peer` by filling the the option object. Keep in mind, that a package can have more than one type, e.g. a dev package that is also optional, which is left out if either of the types is set to `false`. `prod` means a package that is none of the others.

```ts
// All packages a production install needs
const production = lockfile.getAll({ dev: false, optional: false });
```

Yarn does not store these types, so `getAll` treats all yarn packages as `prod`.

`traverse` starts at the dependencies of the importers. Use `dev: false` to skip dev dependencies and `optional: false` to skip optional ones. Use `from` to start at other packages.

```ts
// All packages a production install needs
const production = [...lockfile.traverse({ dev: false, optional: false })];
```

`why` stops after 50 chains. Change this with `{ limit }`.

> [!note]
> `traverse` and `why` need importers. Yarn classic lockfiles have none, so they find nothing there.

### `LockEntry`

One installed package.

| Field                                                      | Description                                                                                  |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `name`, `version`                                          | Name and version of the package                                                              |
| `integrity`, `resolved`                                    | Integrity hash and download URL                                                              |
| `checksum`                                                 | Checksum of the archive (yarn berry only, not an integrity hash)                             |
| `source`                                                   | Where the package comes from: `registry`, `git`, `tarball`, `file` or `workspace`            |
| `dev`, `optional`                                          | `true` if the package is only used through dev or optional dependencies                      |
| `peer`                                                     | `true` if the package is only used through peer dependencies                                 |
| `license`, `deprecated`, `hasInstallScript`                | Package metadata                                                                             |
| `bin`, `engines`, `os`, `cpu`, `libc`                      | Package metadata                                                                             |
| `dependencies`, `optionalDependencies`, `peerDependencies` | Sets of `name@version` keys that point to `entries`. The last two are part of `dependencies` |
| `ranges`                                                   | The requested version range for each dependency name                                         |

> [!note]
> Not every package manager stores every field. See [Package Manager Differences](#package-manager-differences).

### `Importer`

The root project or a workspace package.

| Field                                                                         | Description                                                    |
| ----------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `path`                                                                        | Path relative to the lockfile. It is `''` for the root project |
| `name`, `version`                                                             | Name and version, if the lockfile has them                     |
| `dependencies`, `devDependencies`, `optionalDependencies`, `peerDependencies` | Sets of `name@version` keys that point to `entries`            |

## Package Manager Differences And Limitations

Not all fields are stored by every package manager, so that missing fields in a lockfile are `undefined` (or empty). However, `@lockfiles/parse` tries to infer as much information as possible from the available data. And in case you need more complete information, use [`@lockfiles/enrich`](../enrich).

✅ read from the lockfile &nbsp; 🟡 partial, derived or inferred &nbsp; ❌ not stored in the lockfile

| Data                       | npm | pnpm | yarn classic | yarn berry | bun |
| -------------------------- | :-: | :--: | :----------: | :--------: | :-: |
| `lockfileVersion`          | ✅  |  ✅  |      ✅      |     ✅     | ✅  |
| `integrity`                | ✅  |  ✅  |      ✅      |     ❌     | ✅  |
| `checksum`                 | ❌  |  ❌  |      ❌      |     ✅     | ❌  |
| `resolved`                 | ✅  |  🟡  |      ✅      |     🟡     | ❌  |
| `source`                   | 🟡  |  ✅  |      🟡      |     ✅     | ✅  |
| Non-registry packages      | ✅  |  ✅  |      ✅      |     ✅     | ❌  |
| `dev`                      | ✅  |  🟡  |      ❌      |     ❌     | 🟡  |
| `optional`                 | ✅  |  ✅  |      ❌      |     ❌     | 🟡  |
| `peer`                     | ✅  |  ❌  |      ❌      |     ❌     | ❌  |
| `license`                  | ✅  |  ❌  |      ❌      |     ❌     | ❌  |
| `hasInstallScript`         | ✅  |  🟡  |      ❌      |     ❌     | ❌  |
| `deprecated`               | ✅  |  ✅  |      ❌      |     ❌     | ❌  |
| `bin`                      | ✅  |  ❌  |      ❌      |     ✅     | ✅  |
| `engines`                  | ✅  |  ✅  |      ❌      |     ❌     | ❌  |
| `os`, `cpu`, `libc`        | ✅  |  ✅  |      ❌      |     ✅     | ✅  |
| `optionalDependencies`     | ✅  |  ✅  |      ✅      |     ✅     | ✅  |
| `peerDependencies`         | ✅  |  ✅  |      ❌      |     ❌     | ✅  |
| `ranges`                   | ✅  |  🟡  |      ✅      |     ✅     | ✅  |
| Importers                  | ✅  |  ✅  |      ❌      |     🟡     | ✅  |
| Importer `devDependencies` | ✅  |  ✅  |      ❌      |     ❌     | ✅  |

### Notes

- **npm:** `source` is derived from the `resolved` URL (a `/-/` path segment means registry, and so does the `/<name>/<version>/<hash>` layout of GitHub Packages). Workspace packages are also regular entries with `source: "workspace"`. `package-lock.json` with `lockfileVersion` 1 is not supported.
- **pnpm:** `dev` is read from lockfile v6 and inferred from the importers for v9. `ranges` only contains peer ranges. `resolved` is only set for packages that are not on the default registry (git, tarball and directory packages). `hasInstallScript` is only available for lockfile v6. `lockfileVersion` below 6 is not supported.
- **yarn classic:** the lockfile has no information about the project itself, so there are no importers and no `dev`/`optional` flags.
- **yarn berry:** dev dependencies are merged into the importer's `dependencies`. Peer dependencies are only stored as ranges and are not resolved. `resolved` is only set for non-registry packages.
- **bun:** versions of non-registry packages (git, tarball) are not recorded, so only registry packages appear. `dev` and `optional` are inferred from the importers.

## Missing something?

If you are missing a package manager or a feature, feel free to open an issue or submit a pull request to add support for it.

## License

MIT
