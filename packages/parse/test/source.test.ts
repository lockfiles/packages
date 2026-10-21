import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseNpmLock } from '../src/npm.js';
import { sourceOfUrl } from '../src/util.js';
import { parseYarnLock } from '../src/yarn.js';

const fixturesDir = join(import.meta.dirname, './fixtures');
const react = { name: 'react', version: '18.3.1' };

describe('sourceOfUrl', () => {
  it('should find registries by the /-/ segment', () => {
    expect(sourceOfUrl('https://registry.npmjs.org/react/-/react-18.3.1.tgz')).toBe('registry');
    expect(
      sourceOfUrl('https://npm.example.com/artifactory/api/npm/remote/react/-/react-18.3.1.tgz'),
    ).toBe('registry');
  });

  it('should find the layout of GitHub Packages', () => {
    const url = 'https://npm.pkg.github.com/download/react/18.3.1/0123456789abcdef';

    expect(sourceOfUrl(url, react)).toBe('registry');
    expect(sourceOfUrl(url)).toBe('tarball');
  });

  it('should find scoped packages in that layout', () => {
    const scoped = { name: '@scope/pkg', version: '1.0.0' };

    expect(sourceOfUrl('https://npm.pkg.github.com/download/@scope/pkg/1.0.0/abc123', scoped)).toBe(
      'registry',
    );
    expect(
      sourceOfUrl('https://npm.pkg.github.com/download/%40scope%2Fpkg/1.0.0/abc123', scoped),
    ).toBe('registry');
  });

  it('should treat other URLs as plain tarballs', () => {
    expect(sourceOfUrl('https://example.com/files/react-18.3.1.tgz', react)).toBe('tarball');
    // A file name with an extension is not a hash.
    expect(sourceOfUrl('https://example.com/react/18.3.1/react-18.3.1.tgz', react)).toBe('tarball');
    // Another version or package in the path is not a match either.
    expect(sourceOfUrl('https://example.com/react/17.0.2/abc123', react)).toBe('tarball');
    expect(sourceOfUrl('https://example.com/other/18.3.1/abc123', react)).toBe('tarball');
    expect(sourceOfUrl('not a url', react)).toBe('tarball');
  });

  it('should still find git and file sources first', () => {
    expect(sourceOfUrl('git+ssh://git@github.com/x/react.git#abc', react)).toBe('git');
    expect(sourceOfUrl('file:../react', react)).toBe('file');
  });
});

describe('lockfiles of registries without /-/ in their URLs', () => {
  it('should find registry packages in package-lock.json', async () => {
    const text = (await readFile(join(fixturesDir, 'npm/package-lock.json'), 'utf8')).replace(
      /"resolved": "https:\/\/registry\.npmjs\.org\/(@?[^"]+?)\/-\/[^"]+?-(\d[^"]*?)\.tgz"/g,
      (_, name, version) =>
        `"resolved": "https://npm.pkg.github.com/download/${name}/${version}/abc123"`,
    );

    const lockfile = parseNpmLock(text);

    expect(lockfile.get('react', '18.3.1')!.resolved).toBe(
      'https://npm.pkg.github.com/download/react/18.3.1/abc123',
    );
    expect(lockfile.filter((entry) => entry.source === 'registry')).toHaveLength(lockfile.size);
  });

  it('should find registry packages in yarn.lock', async () => {
    const text = (await readFile(join(fixturesDir, 'yarn-v1/yarn.lock'), 'utf8')).replace(
      /resolved "https:\/\/registry\.yarnpkg\.com\/(@?[^"]+?)\/-\/[^"]+?-(\d[^"#]*?)\.tgz#[0-9a-f]+"/g,
      (_, name, version) =>
        `resolved "https://npm.pkg.github.com/download/${name}/${version}/abc123"`,
    );

    const lockfile = parseYarnLock(text);

    expect(lockfile.get('react', '18.3.1')!.resolved).toContain('npm.pkg.github.com');
    expect(lockfile.filter((entry) => entry.source === 'registry')).toHaveLength(lockfile.size);
  });
});
