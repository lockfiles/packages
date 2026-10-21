---
"@lockfiles/parse": patch
---

Detect packages from registries like GitHub Packages as `source: 'registry'`. Their tarball URLs have no `/-/` segment, so they were reported as `tarball`.
