---
'@lockfiles/parse': minor
---

Add `Lockfile.descriptors` and `Lockfile.resolve(name, range)` for yarn lockfiles, which find the package that a requested version range was resolved to. Export `inferScopes`, which fills `dev` and `optional` from the importers.
