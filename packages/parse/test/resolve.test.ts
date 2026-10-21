import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { inferScopes, Lockfile, parseLockfile } from '../src/index.js';

const fixturesDir = join(import.meta.dirname, './fixtures');
const load = (file: string) => parseLockfile(join(fixturesDir, file));

describe('Lockfile.resolve', () => {
  it('should find the package for a requested range in yarn classic', async () => {
    const lock = await load('yarn-v1/yarn.lock');

    expect(lock.resolve('react', '18.3.1')).toBe(lock.get('react', '18.3.1'));
    expect(lock.resolve('loose-envify', '^1.1.0')).toBe(lock.get('loose-envify', '1.4.0'));
  });

  it('should find the package for a requested range in yarn berry', async () => {
    const lock = await load('yarn-berry/yarn.lock');

    expect(lock.resolve('react', '18.3.1')).toBe(lock.get('react', '18.3.1'));
    expect(lock.resolve('loose-envify', '^1.1.0')).toBe(lock.get('loose-envify', '1.4.0'));
  });

  it('should return undefined for a range that is not in the lockfile', async () => {
    const lock = await load('yarn-v1/yarn.lock');

    expect(lock.resolve('react', '^1.0.0')).toBeUndefined();
    expect(lock.resolve('missing', '1.0.0')).toBeUndefined();
  });

  it('should keep the descriptors of yarn lockfiles', async () => {
    const lock = await load('yarn-v1/yarn.lock');

    expect(lock.descriptors.get('react@18.3.1')).toBe('react@18.3.1');
    expect(lock.descriptors.size).toBeGreaterThan(0);
  });

  it('should tell apart versions of one package in a workspace project', async () => {
    const lock = await load('workspaces/yarn-v1/yarn.lock');

    expect(lock.resolve('js-tokens', '3.0.2')).toBe(lock.get('js-tokens', '3.0.2'));
    expect(lock.resolve('js-tokens', '^3.0.0 || ^4.0.0')).toBeDefined();
  });

  it('should not have descriptors for other package managers', async () => {
    for (const file of ['npm/package-lock.json', 'pnpm/pnpm-lock.yaml', 'bun/bun.lock']) {
      const lock = await load(file);

      expect(lock.descriptors.size).toBe(0);
      expect(lock.resolve('react', '18.3.1')).toBeUndefined();
    }
  });
});

describe('inferScopes', () => {
  it('should fill dev and optional from the importers', () => {
    const lock = new Lockfile('yarn');
    lock.add('prod', '1.0.0', {
      dependencies: ['shared@1.0.0', 'opt@1.0.0'],
      optionalDependencies: ['opt@1.0.0'],
    });
    lock.add('tool', '1.0.0', { dependencies: ['shared@1.0.0'] });
    lock.add('shared', '1.0.0');
    lock.add('opt', '1.0.0');
    lock.add('dev-only', '1.0.0');
    const root = lock.importer('');
    root.dependencies.add('prod@1.0.0');
    root.devDependencies.add('tool@1.0.0');
    root.devDependencies.add('dev-only@1.0.0');

    inferScopes(lock);

    expect(lock.get('prod', '1.0.0')).toMatchObject({ dev: false, optional: false });
    expect(lock.get('shared', '1.0.0')).toMatchObject({ dev: false, optional: false });
    expect(lock.get('opt', '1.0.0')).toMatchObject({ dev: false, optional: true });
    expect(lock.get('tool', '1.0.0')).toMatchObject({ dev: true, optional: false });
    expect(lock.get('dev-only', '1.0.0')).toMatchObject({ dev: true, optional: false });
  });

  it('should not change flags that are already set', () => {
    const lock = new Lockfile('npm');
    lock.add('a', '1.0.0', { dev: true, optional: true });
    lock.importer('').dependencies.add('a@1.0.0');

    inferScopes(lock);

    expect(lock.get('a', '1.0.0')).toMatchObject({ dev: true, optional: true });
  });

  it('should do nothing without importers', () => {
    const lock = new Lockfile('yarn');
    lock.add('a', '1.0.0');

    inferScopes(lock);

    expect(lock.get('a', '1.0.0')!.dev).toBeUndefined();
  });
});
