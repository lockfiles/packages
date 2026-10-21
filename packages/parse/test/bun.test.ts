import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseBunLock } from '../src/bun.js';

const fixturesDir = join(import.meta.dirname, './fixtures');
const load = async () => parseBunLock(await readFile(join(fixturesDir, 'bun/bun.lock'), 'utf-8'));

describe('bun lockfile parser', () => {
  it('should parse bun.lock', async () => {
    const lock = await load();

    expect(lock.kind).toBe('bun');
    expect(lock.lockfileVersion).toBe('2');
    expect(lock.entries.size).toBeGreaterThan(0);
  });

  it('should extract package information', async () => {
    const react = (await load()).get('react', '18.3.1')!;

    expect(react).toBeDefined();
    expect(react.integrity).toMatch(/^sha512-/);
    expect(react.source).toBe('registry');
    expect(react.resolved).toBeUndefined();
  });

  it('should extract the root project as importer', async () => {
    const root = (await load()).importers.get('')!;

    expect(root.name).toBe('fixture');
    expect([...root.dependencies].sort()).toEqual(['react-dom@18.3.1', 'react@18.3.1']);
    expect([...root.devDependencies].sort()).toEqual(['esbuild@0.24.0', 'typescript@5.6.3']);
    expect([...root.optionalDependencies]).toEqual(['fsevents@2.3.3']);
  });

  it('should extract dependency and peer information', async () => {
    const reactDom = (await load()).get('react-dom', '18.3.1')!;

    expect([...reactDom.dependencies].sort()).toEqual([
      'loose-envify@1.4.0',
      'react@18.3.1',
      'scheduler@0.23.2',
    ]);
    expect([...reactDom.peerDependencies]).toEqual(['react@18.3.1']);
    expect(reactDom.ranges.scheduler).toBe('^0.23.2');
  });

  it('should infer dev and optional packages', async () => {
    const lock = await load();

    expect(lock.get('react', '18.3.1')).toMatchObject({ dev: false, optional: false });
    expect(lock.get('typescript', '5.6.3')).toMatchObject({ dev: true, optional: false });
    expect(lock.get('fsevents', '2.3.3')).toMatchObject({ dev: false, optional: true });
    expect(lock.get('@esbuild/darwin-arm64', '0.24.0')).toMatchObject({
      dev: true,
      optional: true,
    });
  });

  it('should extract optional dependencies, platforms and binaries', async () => {
    const lock = await load();
    const esbuild = lock.get('esbuild', '0.24.0')!;

    expect(esbuild.optionalDependencies.size).toBeGreaterThan(20);
    expect(esbuild.bin).toEqual({ esbuild: 'bin/esbuild' });
    expect(lock.get('@esbuild/darwin-arm64', '0.24.0')).toMatchObject({
      os: ['darwin'],
      cpu: ['arm64'],
    });
  });

  it('should throw error for a lockfile without packages', () => {
    expect(() => parseBunLock('{"lockfileVersion": 1}')).toThrow(/packages/);
  });
});
