# @lockfiles/parse

## 0.1.1

### Patch Changes

- [`4612a90`](https://github.com/lockfiles/tools/commit/4612a90128609c460881910ce5d594daf5872eac) Thanks [@philSixZero](https://github.com/philSixZero)! - Minor chores and changes in the release action.

## 0.1.0

### Minor Changes

- [`212d160`](https://github.com/lockfiles/tools/commit/212d16081a4799bb64777ed9fadc6f81b8ca9e78) Thanks [@philSixZero](https://github.com/philSixZero)! - Add `Lockfile.descriptors` and `Lockfile.resolve(name, range)` for yarn lockfiles, which find the package that a requested version range was resolved to. Export `inferScopes`, which fills `dev` and `optional` from the importers.

### Patch Changes

- [`212d160`](https://github.com/lockfiles/tools/commit/212d16081a4799bb64777ed9fadc6f81b8ca9e78) Thanks [@philSixZero](https://github.com/philSixZero)! - Detect packages from registries like GitHub Packages as `source: 'registry'`. Their tarball URLs have no `/-/` segment, so they were reported as `tarball`.
