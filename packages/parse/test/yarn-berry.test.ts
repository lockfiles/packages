import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseYarnLock } from '../src/yarn.js';

const fixturesDir = join(import.meta.dirname, './fixtures');
const load = async () =>
  parseYarnLock(await readFile(join(fixturesDir, 'yarn-berry/yarn.lock'), 'utf-8'));

describe('yarn berry lockfile parser', () => {
  it('should parse yarn.lock berry format', async () => {
    const lock = await load();

    expect(lock.kind).toBe('yarn');
    expect(lock.lockfileVersion).toBe('10');
    expect(lock.entries.size).toBeGreaterThan(0);
  });

  it('should extract package information', async () => {
    const react = (await load()).get('react', '18.3.1')!;

    expect(react).toBeDefined();
    expect(react.checksum).toMatch(/^10c0\//);
    expect(react.source).toBe('registry');
    expect(react.integrity).toBeUndefined();
  });

  it('should extract dependency information', async () => {
    const reactDom = (await load()).get('react-dom', '18.3.1')!;

    expect([...reactDom.dependencies].sort()).toEqual(['loose-envify@1.4.0', 'scheduler@0.23.2']);
    expect(reactDom.ranges.scheduler).toBe('npm:^0.23.2');
  });

  it('should extract the workspace as importer and not as package', async () => {
    const lock = await load();
    const root = lock.importers.get('')!;

    expect(root.name).toBe('fixture');
    expect(root.version).toBeUndefined();
    expect([...root.optionalDependencies]).toEqual(['fsevents@2.3.3']);
    expect(lock.versionsOf('fixture')).toEqual([]);
  });

  it('should merge dev dependencies into the importer dependencies', async () => {
    const root = (await load()).importers.get('')!;

    expect([...root.dependencies].sort()).toEqual([
      'esbuild@0.24.0',
      'react-dom@18.3.1',
      'react@18.3.1',
      'typescript@5.6.3',
    ]);
    expect(root.devDependencies.size).toBe(0);
  });

  it('should extract optional dependencies of a package', async () => {
    const esbuild = (await load()).get('esbuild', '0.24.0')!;

    expect(esbuild.optionalDependencies.size).toBeGreaterThan(20);
    expect(esbuild.optionalDependencies).toContain('@esbuild/darwin-arm64@0.24.0');
  });

  it('should extract platform conditions and binaries', async () => {
    const lock = await load();

    expect(lock.get('fsevents', '2.3.3')).toMatchObject({ os: ['darwin'] });
    expect(lock.get('@esbuild/darwin-arm64', '0.24.0')).toMatchObject({
      os: ['darwin'],
      cpu: ['arm64'],
    });
    expect(lock.get('typescript', '5.6.3')!.bin).toEqual({
      tsc: 'bin/tsc',
      tsserver: 'bin/tsserver',
    });
  });

  it('should not report what yarn berry does not store', async () => {
    const lock = await load();

    expect(lock.get('typescript', '5.6.3')!.dev).toBeUndefined();
    expect(lock.get('react-dom', '18.3.1')!.peerDependencies.size).toBe(0);
  });
});
