import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseNpmLock } from '../src/npm.js';

const fixturesDir = join(import.meta.dirname, './fixtures');
const load = async () =>
  parseNpmLock(await readFile(join(fixturesDir, 'npm/package-lock.json'), 'utf-8'));

describe('npm lockfile parser', () => {
  it('should parse package-lock.json v3 format', async () => {
    const lock = await load();

    expect(lock.kind).toBe('npm');
    expect(lock.lockfileVersion).toBe('3');
    expect(lock.entries.size).toBeGreaterThan(0);
  });

  it('should extract package information', async () => {
    const react = (await load()).get('react', '18.3.1')!;

    expect(react).toBeDefined();
    expect(react.resolved).toBe('https://registry.npmjs.org/react/-/react-18.3.1.tgz');
    expect(react.integrity).toMatch(/^sha512-/);
    expect(react.source).toBe('registry');
    expect(react.license).toBe('MIT');
    expect(react.engines).toEqual({ node: '>=0.10.0' });
  });

  it('should extract the root project as importer', async () => {
    const root = (await load()).importers.get('')!;

    expect(root.name).toBe('fixture');
    expect(root.version).toBe('1.0.0');
    expect([...root.dependencies].sort()).toEqual(['react-dom@18.3.1', 'react@18.3.1']);
    expect([...root.devDependencies].sort()).toEqual(['esbuild@0.24.0', 'typescript@5.6.3']);
    expect([...root.optionalDependencies]).toEqual(['fsevents@2.3.3']);
  });

  it('should extract dependency information', async () => {
    const reactDom = (await load()).get('react-dom', '18.3.1')!;

    expect([...reactDom.dependencies].sort()).toEqual([
      'loose-envify@1.4.0',
      'react@18.3.1',
      'scheduler@0.23.2',
    ]);
    expect(reactDom.ranges.scheduler).toBe('^0.23.2');
  });

  it('should extract peer dependencies', async () => {
    const reactDom = (await load()).get('react-dom', '18.3.1')!;

    expect([...reactDom.peerDependencies]).toEqual(['react@18.3.1']);
    expect(reactDom.ranges.react).toBe('^18.3.1');
  });

  it('should mark dev packages', async () => {
    const lock = await load();

    expect(lock.get('typescript', '5.6.3')).toMatchObject({ dev: true, optional: false });
    expect(lock.get('react', '18.3.1')).toMatchObject({ dev: false, optional: false });
  });

  it('should mark optional packages and their platform', async () => {
    const lock = await load();

    expect(lock.get('fsevents', '2.3.3')).toMatchObject({
      dev: false,
      optional: true,
      os: ['darwin'],
    });
    expect(lock.get('@esbuild/darwin-arm64', '0.24.0')).toMatchObject({
      dev: true,
      optional: true,
      os: ['darwin'],
      cpu: ['arm64'],
    });
  });

  it('should extract optional dependencies of a package', async () => {
    const esbuild = (await load()).get('esbuild', '0.24.0')!;

    expect(esbuild.optionalDependencies.size).toBeGreaterThan(20);
    expect(esbuild.optionalDependencies).toContain('@esbuild/darwin-arm64@0.24.0');
    expect(esbuild.dependencies).toContain('@esbuild/darwin-arm64@0.24.0');
  });

  it('should extract package metadata', async () => {
    const lock = await load();

    expect(lock.get('typescript', '5.6.3')).toMatchObject({
      license: 'Apache-2.0',
      bin: { tsc: 'bin/tsc', tsserver: 'bin/tsserver' },
      engines: { node: '>=14.17' },
    });
    expect(lock.get('esbuild', '0.24.0')!.hasInstallScript).toBe(true);
  });

  it('should list every version of a package', async () => {
    const lock = await load();

    expect(lock.versionsOf('react')).toEqual(['18.3.1']);
    expect(lock.get('react', '0.0.0')).toBeUndefined();
  });

  it('should throw error for invalid JSON', () => {
    expect(() => parseNpmLock('not valid json')).toThrow(/JSON/);
  });

  it('should throw error for non-npm lockfile', () => {
    expect(() => parseNpmLock('{"name": "test"}')).toThrow(/package-lock/);
  });

  it('should throw error for lockfileVersion 1', () => {
    expect(() => parseNpmLock('{"lockfileVersion":1,"dependencies":{}}')).toThrow(/not supported/);
  });
});
