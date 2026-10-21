# lockfiles

Small and efficient TypeScript tools for working with the **lockfiles of any JavaScript package manager**.

## Packages

| Package                                | Description                                                                             |
| -------------------------------------- | --------------------------------------------------------------------------------------- |
| [`@lockfiles/parse`](packages/parse)   | Parses a lockfile and gives you the same data, no matter which package manager wrote it |
| [`@lockfiles/diff`](packages/diff)     | Diff lockfiles of any package manager                                                   |
| [`@lockfiles/enrich`](packages/enrich) | Fills in what a lockfile does not store, like dev and optional flags and licenses       |

## Development

You need Node.js 22 or newer and [pnpm](https://pnpm.io). The pnpm version is set in `package.json`, so with Corepack (`corepack enable`) the right one is used automatically.

```sh
pnpm install
pnpm build       # build all packages, the parser first
pnpm typecheck
pnpm test
pnpm lint
pnpm format
```

The packages depend on each other through their built files, so run `pnpm build` before `typecheck` and `test` if you changed the parser.

Tests use real lockfiles that were created with each package manager. They are in `packages/*/test/fixtures`.

## Releases

This repository uses [Changesets](https://github.com/changesets/changesets) to version and release the packages.

1. Change a package. Run `pnpm changeset`, choose the packages and the size of the change (`patch`, `minor` or `major`) and write a short note for the release notes.
2. Commit the new file in `.changeset/` with your pull request.
3. When the pull request is merged into `main`, a bot opens a "chore: version packages" pull request. It bumps the versions and writes the changelogs.
4. Merging that pull request publishes the new versions to npm and creates the GitHub releases.

Pull requests that change a package without a changeset fail the `changeset` check.

## License

MIT
