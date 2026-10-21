import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseYarnLock } from '../src/yarn.js';

const fixturesDir = join(import.meta.dirname, './fixtures');
const load = async () =>
  parseYarnLock(await readFile(join(fixturesDir, 'yarn-v1/yarn.lock'), 'utf-8'));

describe('yarn v1 lockfile parser', () => {
  it('should parse yarn.lock v1 format', async () => {
    const lock = await load();

    expect(lock.kind).toBe('yarn');
    expect(lock.lockfileVersion).toBe('1');
    expect(lock.entries.size).toBeGreaterThan(0);
  });

  it('should extract package information', async () => {
    const react = (await load()).get('react', '18.3.1')!;

    expect(react).toBeDefined();
    expect(react.resolved).toMatch(
      /^https:\/\/registry\.yarnpkg\.com\/react\/-\/react-18\.3\.1\.tgz#/,
    );
    expect(react.integrity).toMatch(/^sha512-/);
    expect(react.source).toBe('registry');
  });

  it('should extract dependency information', async () => {
    const reactDom = (await load()).get('react-dom', '18.3.1')!;

    expect([...reactDom.dependencies].sort()).toEqual(['loose-envify@1.4.0', 'scheduler@0.23.2']);
    expect(reactDom.ranges.scheduler).toBe('^0.23.2');
  });

  it('should extract optional dependencies', async () => {
    const lock = await load();
    const esbuild = lock.get('esbuild', '0.24.0')!;

    expect(esbuild.optionalDependencies.size).toBeGreaterThan(20);
    expect(esbuild.optionalDependencies).toContain('@esbuild/darwin-arm64@0.24.0');
    expect(lock.get('fsevents', '2.3.3')).toBeDefined();
  });

  it('should not report what yarn v1 does not store', async () => {
    const lock = await load();

    expect(lock.importers.size).toBe(0);
    expect(lock.get('react-dom', '18.3.1')!.peerDependencies.size).toBe(0);
    expect(lock.get('typescript', '5.6.3')!.dev).toBeUndefined();
    expect(lock.get('fsevents', '2.3.3')!.os).toBeUndefined();
  });

  it('should handle quoted descriptors, scoped names, ranges with spaces and CRLF', () => {
    const lock = parseYarnLock(
      [
        '# yarn lockfile v1',
        '',
        '"@scope/a@>=1.0.0 <2.0.0", "@scope/a@^1.2.0", a-alias@^1.0.0:',
        '  version "1.2.0"',
        '  resolved "https://registry.yarnpkg.com/@scope/a/-/a-1.2.0.tgz#abc"',
        '  integrity sha512-aaa',
        '  dependencies:',
        '    "@scope/b" "^2.0.0"',
        '    c ">=1 <3"',
        '',
        '"@scope/b@^2.0.0":',
        '  version "2.1.0"',
        '',
        '"c@>=1 <3":',
        '  version "2.0.0"',
        '',
      ].join('\r\n'),
    );

    expect([...lock.get('@scope/a', '1.2.0')!.dependencies].sort()).toEqual([
      '@scope/b@2.1.0',
      'c@2.0.0',
    ]);
    expect(lock.get('@scope/a', '1.2.0')!.ranges).toEqual({
      '@scope/b': '^2.0.0',
      c: '>=1 <3',
    });
  });

  it('should throw for fields outside of an entry', () => {
    expect(() => parseYarnLock('# yarn lockfile v1\n\n  version "1.0.0"\n')).toThrow(/yarn\.lock/);
  });
});
