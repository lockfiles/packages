# @lockfiles/enrich

All package managers except `npm` leave out quite relevant package information (see [`@lockfiles/parse`](../parse/README.md#package-manager-differences-and-limitations)). This is where `@lockfiles/enrich` comes in: it tries best it can **to fill the gap** by collecting the missing pieces from either local files or the `npm` registry.

## Quick Guide

### Installation

```bash
npm i @lockfiles/enrich
```

### Usage

```ts
import { parseLockfile } from '@lockfiles/parse';
import { enrich } from '@lockfiles/enrich';

const lockfile = await parseLockfile('./yarn.lock');
const report = await enrich(lockfile, { projectDir: '.' });

// Yarn does not store this, but now we know:
console.log(lockfile.getAll({ dev: false, optional: false }));
```

`enrich` changes the lockfile you give it. It never replaces a value that the lockfile already has.

## How it works

`enrich` uses three steps:

| Step           | Option        | What it does                                                                                                                                                         | Default |
| -------------- | ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| `project`      | `project`     | Reads the `package.json` of the project and its workspaces to see which dependencies are dev or optional, and follows them through the lockfile. Yarn only.          | on      |
| `node_modules` | `nodeModules` | Reads license, engines, `bin`, `os`, `cpu`, `libc` and install scripts from installed packages. It finds packages in `node_modules` and in the pnpm store (`.pnpm`). | on      |
| `registry`     | `registry`    | Asks the npm registry for what is still missing, including `integrity`, `resolved` and `deprecated`, which only the registry knows.                                  | off     |

All steps only fill what the package manager does not store, so they do not touch properties that the lockfile already has.

| Package manager | What can be filled                                                                                    |
| --------------- | ----------------------------------------------------------------------------------------------------- |
| npm             | nothing                                                                                               |
| pnpm            | `resolved`, `license`, `bin`, `hasInstallScript`                                                      |
| yarn classic    | `dev`, `optional`, `license`, `engines`, `bin`, `os`, `cpu`, `libc`, `hasInstallScript`, `deprecated` |
| yarn berry      | `dev`, `optional`, `integrity`, `resolved`, `license`, `engines`, `hasInstallScript`, `deprecated`    |
| bun             | `resolved`, `license`, `engines`, `hasInstallScript`, `deprecated`                                    |

## API

### `enrich(lockfile, options?): Promise<EnrichReport>`

#### Options

| Option        | Type                         | Default         | Description                                                          |
| ------------- | ---------------------------- | --------------- | -------------------------------------------------------------------- |
| `projectDir`  | `string`                     | `process.cwd()` | The folder with the `package.json` and `node_modules` of the project |
| `project`     | `boolean`                    | `true`          | Read the `package.json` files to find dev and optional packages      |
| `nodeModules` | `boolean`                    | `true`          | Read installed packages                                              |
| `registry`    | `boolean \| RegistryOptions` | `false`         | Ask the npm registry. `true` uses the defaults                       |

`RegistryOptions`:

| Option        | Type           | Default                      | Description                                               |
| ------------- | -------------- | ---------------------------- | --------------------------------------------------------- |
| `url`         | `string`       | `https://registry.npmjs.org` | The registry to ask                                       |
| `concurrency` | `number`       | `16`                         | How many requests run at the same time                    |
| `timeout`     | `number`       | `30000`                      | Time limit for one request in milliseconds                |
| `fetch`       | `typeof fetch` | the global `fetch`           | Use it to add headers like authentication, or for mocking |
| `signal`      | `AbortSignal`  |                              | Stops all requests                                        |

```ts
await enrich(lockfile, {
  projectDir: '.',
  registry: { url: 'https://registry.example.com', concurrency: 8 },
});
```

#### The report

`enrich` returns a report of what it did:

| Field        | Description                                                                                                   |
| ------------ | ------------------------------------------------------------------------------------------------------------- |
| `filled`     | How many values were filled for each field, like `{ dev: 120, license: 118 }`                                 |
| `sources`    | Where each value came from (`project`, `node_modules` or `registry`), as a `Map` keyed by `name@version`      |
| `unresolved` | Dependencies in a `package.json` that are not in the lockfile, like `packages/app: react@^18.0.0`             |
| `failed`     | Packages the registry could not give data for, with the reason, like `{ key: 'a@1.0.0', error: 'not found' }` |

```ts
const report = await enrich(lockfile, { registry: true });

report.sources.get('react@18.3.1'); // { dev: 'project', license: 'registry', ... }
```

## Good to know

- **Dev and optional need `package.json` files.** The lockfile alone is not enough for yarn. Without a `package.json` in `projectDir`, this step does nothing. Workspaces are found through the `workspaces` field or `pnpm-workspace.yaml`.
- **Importers are created for yarn.** After the first step, a yarn lockfile has importers for the project and its workspaces, so `traverse` and `why` of the parser work, also for yarn classic.
- **Only registry packages are looked up.** Packages from git, tarballs, files and workspaces have no registry data and are skipped.
- **`hasInstallScript`** is only set to `true`. It means that the package has a `preinstall`, `install` or `postinstall` script, or a `binding.gyp`.
- **Licenses are what the package declares.** This can be an SPDX id, an expression like `(MIT OR Apache-2.0)` or text like `SEE LICENSE IN LICENSE.md`.
- **Private registries** work through the `url` and `fetch` options. Reading `.npmrc` is not supported.
- **Network failures do not stop `enrich`.** Packages that could not be fetched are listed in `report.failed`.

## License

MIT
