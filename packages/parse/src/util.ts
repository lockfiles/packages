import type { Lockfile, Source } from './lockfile.js';

export const asList = (value: string | string[] | undefined): string[] | undefined =>
  value === undefined ? undefined : Array.isArray(value) ? value : [value];

export function asBin(bin: unknown, name: string): Record<string, string> | undefined {
  if (typeof bin === 'string') return { [name.slice(name.lastIndexOf('/') + 1)]: bin };
  return bin && typeof bin === 'object' ? (bin as Record<string, string>) : undefined;
}

export const asLicense = (license: unknown): string | undefined =>
  typeof license === 'string' ? license : undefined;

const GIT_URL =
  /^(?:git(?:\+|:)|github:|gitlab:|bitbucket:|gist:)|\.git(?:#|$)|codeload\.github\.com/;

/** Some registries, like GitHub Packages, serve tarballs from `/<name>/<version>/<hash>` instead. */
function hasRegistryLayout(url: string, pkg: { name: string; version: string }): boolean {
  let pathname: string;
  try {
    pathname = decodeURIComponent(new URL(url).pathname);
  } catch {
    return false;
  }
  const marker = `/${pkg.name}/${pkg.version}/`;
  const at = pathname.indexOf(marker);
  if (at < 0) return false;
  // The last segment is a hash. A file name with an extension means a plain tarball.
  const rest = pathname.slice(at + marker.length);
  return rest !== '' && !rest.includes('/') && !rest.includes('.');
}

/**
 * Registry tarballs have a `/-/` path segment, or the layout above if the package is known.
 * Other http(s) URLs are treated as plain tarballs.
 */
export function sourceOfUrl(url: string, pkg?: { name: string; version: string }): Source {
  if (url.startsWith('file:')) return 'file';
  if (GIT_URL.test(url)) return 'git';
  if (url.includes('/-/') || (pkg && hasRegistryLayout(url, pkg))) return 'registry';
  return 'tarball';
}

/**
 * Fills `dev` and `optional` where the lockfile did not record them, by walking the dependency graph from the importers.
 * `dev`: not reachable from any non-dev root. `optional`: not reachable without crossing an optional edge.
 */
export function inferScopes(lockfile: Lockfile): void {
  const importers = [...lockfile.importers.values()];
  if (importers.length === 0) return;

  const reach = (roots: Iterable<string>, skipOptionalEdges: boolean): Set<string> => {
    const seen = new Set<string>();
    const stack = [...roots];
    for (let key = stack.pop(); key !== undefined; key = stack.pop()) {
      const entry = lockfile.entries.get(key);
      if (!entry || seen.has(key)) continue;
      seen.add(key);
      for (const dep of entry.dependencies) {
        if (!(skipOptionalEdges && entry.optionalDependencies.has(dep))) stack.push(dep);
      }
    }
    return seen;
  };

  const prod = reach(
    importers.flatMap((i) => [...i.dependencies, ...i.optionalDependencies, ...i.peerDependencies]),
    false,
  );
  const required = reach(
    importers.flatMap((i) => [...i.dependencies, ...i.devDependencies, ...i.peerDependencies]),
    true,
  );
  for (const [key, entry] of lockfile.entries) {
    entry.dev ??= !prod.has(key);
    entry.optional ??= !required.has(key);
  }
}
