import { Lockfile } from '@lockfiles/parse';
import { afterEach, describe, expect, it } from 'vitest';
import { enrich } from '../src/index.js';
import { createProject, loadFixture } from './helpers.js';

const removers: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(removers.splice(0).map((remove) => remove()));
});

async function project(files: Record<string, unknown>) {
  const created = await createProject(files);
  removers.push(created.remove);
  return created.dir;
}

const run = (lockfile: Lockfile, projectDir: string) =>
  enrich(lockfile, { projectDir, project: false });

describe('metadata from node_modules', () => {
  it('should fill the metadata of installed packages', async () => {
    const dir = await project({
      'node_modules/react/package.json': {
        name: 'react',
        version: '18.3.1',
        license: 'MIT',
        engines: { node: '>=0.10.0' },
      },
      'node_modules/esbuild/package.json': {
        name: 'esbuild',
        version: '0.24.0',
        license: 'MIT',
        bin: { esbuild: 'bin/esbuild' },
        scripts: { postinstall: 'node install.js' },
      },
      'node_modules/fsevents/package.json': {
        name: 'fsevents',
        version: '2.3.3',
        license: 'MIT',
        os: ['darwin'],
      },
    });
    const lockfile = await loadFixture('yarn-v1/yarn.lock');

    const report = await run(lockfile, dir);

    expect(lockfile.get('react', '18.3.1')).toMatchObject({
      license: 'MIT',
      engines: { node: '>=0.10.0' },
    });
    expect(lockfile.get('esbuild', '0.24.0')).toMatchObject({
      license: 'MIT',
      bin: { esbuild: 'bin/esbuild' },
      hasInstallScript: true,
    });
    expect(lockfile.get('fsevents', '2.3.3')).toMatchObject({ license: 'MIT', os: ['darwin'] });
    expect(report.sources.get('react@18.3.1')).toMatchObject({
      license: 'node_modules',
      engines: 'node_modules',
    });
    expect(report.filled.license).toBe(3);
  });

  it('should only use a package with the version of the lockfile', async () => {
    const dir = await project({
      'node_modules/react/package.json': { name: 'react', version: '17.0.2', license: 'MIT' },
    });
    const lockfile = await loadFixture('yarn-v1/yarn.lock');

    await run(lockfile, dir);

    expect(lockfile.get('react', '18.3.1')!.license).toBeUndefined();
  });

  it('should read scoped packages', async () => {
    const dir = await project({
      '.keep': '',
      'node_modules/@esbuild/darwin-arm64/package.json': {
        name: '@esbuild/darwin-arm64',
        version: '0.24.0',
        license: 'MIT',
        os: ['darwin'],
        cpu: ['arm64'],
      },
    });
    const lockfile = await loadFixture('yarn-v1/yarn.lock');

    await run(lockfile, dir);

    expect(lockfile.get('@esbuild/darwin-arm64', '0.24.0')).toMatchObject({
      os: ['darwin'],
      cpu: ['arm64'],
    });
  });

  it('should find packages in the pnpm store', async () => {
    const dir = await project({
      'node_modules/.pnpm/react@18.3.1/node_modules/react/package.json': {
        name: 'react',
        version: '18.3.1',
        license: 'MIT',
      },
      'node_modules/.pnpm/react-dom@18.3.1_react@18.3.1/node_modules/react-dom/package.json': {
        name: 'react-dom',
        version: '18.3.1',
        license: 'MIT',
      },
      'node_modules/.pnpm/@esbuild+darwin-arm64@0.24.0/node_modules/@esbuild/darwin-arm64/package.json':
        { name: '@esbuild/darwin-arm64', version: '0.24.0', license: 'MIT' },
    });
    const lockfile = await loadFixture('yarn-v1/yarn.lock');

    await run(lockfile, dir);

    expect(lockfile.get('react', '18.3.1')!.license).toBe('MIT');
    expect(lockfile.get('react-dom', '18.3.1')!.license).toBe('MIT');
    expect(lockfile.get('@esbuild/darwin-arm64', '0.24.0')!.license).toBe('MIT');
  });

  it('should find an install script through binding.gyp', async () => {
    const dir = await project({
      'node_modules/fsevents/package.json': { name: 'fsevents', version: '2.3.3' },
      'node_modules/fsevents/binding.gyp': '{}',
    });
    const lockfile = await loadFixture('yarn-v1/yarn.lock');

    await run(lockfile, dir);

    expect(lockfile.get('fsevents', '2.3.3')!.hasInstallScript).toBe(true);
  });

  it('should not replace values that the lockfile has', async () => {
    const dir = await project({
      'node_modules/a/package.json': { name: 'a', version: '1.0.0', license: 'ISC', os: ['linux'] },
    });
    const lockfile = new Lockfile('yarn');
    lockfile.lockfileVersion = '1';
    lockfile.add('a', '1.0.0', { source: 'registry', license: 'MIT' });

    await run(lockfile, dir);

    expect(lockfile.get('a', '1.0.0')).toMatchObject({ license: 'MIT', os: ['linux'] });
  });

  it('should only fill what the package manager does not store', async () => {
    const dir = await project({
      'node_modules/a/package.json': {
        name: 'a',
        version: '1.0.0',
        license: 'MIT',
        engines: { node: '>=18' },
        os: ['linux'],
        bin: { a: 'cli.js' },
      },
    });
    const lockfile = new Lockfile('bun');
    lockfile.add('a', '1.0.0', { source: 'registry' });

    await run(lockfile, dir);

    // Bun stores os and bin, so they are not read from the package.
    expect(lockfile.get('a', '1.0.0')).toMatchObject({ license: 'MIT', engines: { node: '>=18' } });
    expect(lockfile.get('a', '1.0.0')!.os).toBeUndefined();
    expect(lockfile.get('a', '1.0.0')!.bin).toBeUndefined();
  });

  it('should skip packages that are not from the registry', async () => {
    const dir = await project({
      'node_modules/a/package.json': { name: 'a', version: '1.0.0', license: 'MIT' },
    });
    const lockfile = new Lockfile('yarn');
    lockfile.lockfileVersion = '1';
    lockfile.add('a', '1.0.0', { source: 'git' });

    await run(lockfile, dir);

    expect(lockfile.get('a', '1.0.0')!.license).toBeUndefined();
  });

  it('should not read anything for npm lockfiles', async () => {
    const dir = await project({
      'node_modules/react/package.json': { name: 'react', version: '18.3.1', license: 'ISC' },
    });
    const lockfile = await loadFixture('npm/package-lock.json');

    const report = await run(lockfile, dir);

    expect(report.filled).toEqual({});
    expect(lockfile.get('react', '18.3.1')!.license).toBe('MIT');
  });

  it('should work without node_modules and with nodeModules: false', async () => {
    const empty = await project({ '.keep': '' });
    const withModules = await project({
      'node_modules/react/package.json': { name: 'react', version: '18.3.1', license: 'MIT' },
    });
    const first = await loadFixture('yarn-v1/yarn.lock');
    const second = await loadFixture('yarn-v1/yarn.lock');

    expect((await run(first, empty)).filled).toEqual({});
    await enrich(second, { projectDir: withModules, project: false, nodeModules: false });

    expect(second.get('react', '18.3.1')!.license).toBeUndefined();
  });
});
