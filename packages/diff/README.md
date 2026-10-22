# @lockfiles/diff

Compare two lockfiles and see what was **added, removed or updated**. The lockfiles can come from different package managers (npm, pnpm, yarn and bun), because the packages are read with [`@lockfiles/parse`](../parse).

## Quick Guide

### Installation

```bash
npm i @lockfiles/diff
```

### Usage

```ts
import { diffLockfileFiles, formatDiff } from '@lockfiles/diff';

const diff = await diffLockfileFiles('./old/package-lock.json', './package-lock.json');

console.log(formatDiff(diff));
// 1 added, 1 removed, 2 updated
//
// + semver@7.6.3
// - lodash@4.17.20
// ~ react 18.2.0 -> 18.3.1 (minor upgrade)
// ~ typescript 5.5.4 -> 5.6.3 (minor upgrade)
```

## API

### `diffLockfileFiles(before, after, options?): Promise<LockfileDiff>`

Parses two lockfiles and compares them. `before` and `after` are each the path to a lockfile or the content of one, like in `parseLockfile` from the parser.

### `diffLockfiles(before, after, options?): LockfileDiff`

Compares two lockfiles that are already parsed with `@lockfiles/parse`. It is synchronous.

```ts
import { parseLockfile } from '@lockfiles/parse';
import { diffLockfiles } from '@lockfiles/diff';

const diff = diffLockfiles(await parseLockfile('./old.lock'), await parseLockfile('./new.lock'));
```

### `formatDiff(diff, options?): string`

Turns a diff into text. Use `{ format: 'markdown' }` for Markdown, for example for a comment on a pull request. The default is plain text.

### Options

`options` is the same object as in `Lockfile.getAll` of the parser. Set a type to `false` to ignore the packages of that type.

```ts
// Ignore dev dependencies
await diffLockfileFiles(before, after, { dev: false });
```

### `LockfileDiff`

| Field              | Description                                                                  |
| ------------------ | ---------------------------------------------------------------------------- |
| `added`            | Packages that are only in the new lockfile. One entry for each version       |
| `removed`          | Packages that are only in the old lockfile. One entry for each version       |
| `changed`          | Packages that are in both lockfiles, but with different versions (see below) |
| `integrityChanged` | Packages with the same version, but a different integrity hash               |
| `isEmpty`          | `true` if nothing changed                                                    |

Each entry of `changed` has:

| Field       | Description                                                                                 |
| ----------- | ------------------------------------------------------------------------------------------- |
| `name`      | The package name                                                                            |
| `before`    | The versions that are only in the old lockfile                                              |
| `after`     | The versions that are only in the new lockfile                                              |
| `direction` | `upgrade` or `downgrade`. Only set if there is one version on each side and both are semver |
| `bump`      | `major`, `minor`, `patch` or `prerelease`. Set together with `direction`                    |

## Notes

- Packages are matched by **name**. A package that exists in several versions can be listed in `added`, `removed` and `changed` at the same time.
- **Workspace packages are ignored.** They belong to your project and are not dependencies.
- A different **integrity hash** for the same version should never happen. It can mean that a package was changed after it was published, so it is reported on its own. Yarn berry lockfiles have no integrity hash, so nothing is compared for them.
- Lockfiles of different package managers may look different even if they install the same packages. For example, yarn doesn't store which packages are dev dependencies.

## License

MIT
