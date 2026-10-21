import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Lockfile, parseLockfile, type LockEntry } from '../src/index.js';

const fixturesDir = join(import.meta.dirname, './fixtures');
const load = (file: string) => parseLockfile(join(fixturesDir, file));
const names = (entries: Iterable<LockEntry>) => [...entries].map((e) => e.name).sort();
const chainNames = (chains: LockEntry[][]) => chains.map((chain) => chain.map((e) => e.name));

describe('Lockfile methods', () => {
  describe('size, iteration and filter', () => {
    it('should expose the number of packages', async () => {
      const lock = await load('npm/package-lock.json');

      expect(lock.size).toBe(lock.entries.size);
      expect(lock.size).toBeGreaterThan(0);
    });

    it('should loop over all packages', async () => {
      const lock = await load('npm/package-lock.json');

      expect([...lock]).toHaveLength(lock.size);
      expect([...lock][0]).toHaveProperty('version');
    });

    it('should filter packages', async () => {
      const lock = await load('npm/package-lock.json');

      expect(names(lock.filter((e) => e.hasInstallScript))).toEqual(['esbuild', 'fsevents']);
    });
  });

  describe('getAll', () => {
    const production = ['js-tokens', 'loose-envify', 'react', 'react-dom', 'scheduler'];

    it('should return every package without arguments', async () => {
      const lock = await load('npm/package-lock.json');

      expect(lock.getAll()).toHaveLength(lock.size);
      expect(lock.getAll({})).toHaveLength(lock.size);
      expect(lock.getAll({ prod: true, dev: true, optional: true, peer: true })).toHaveLength(
        lock.size,
      );
    });

    it('should leave out dev packages', async () => {
      const lock = await load('npm/package-lock.json');
      const result = names(lock.getAll({ dev: false }));

      expect(result).not.toContain('typescript');
      expect(result).not.toContain('esbuild');
      expect(result).not.toContain('@esbuild/darwin-arm64');
      expect(result).toContain('fsevents');
      expect(result).toContain('react');
    });

    it('should leave out optional packages', async () => {
      const lock = await load('npm/package-lock.json');
      const result = names(lock.getAll({ optional: false }));

      expect(result).not.toContain('fsevents');
      expect(result).not.toContain('@esbuild/darwin-arm64');
      expect(result).toContain('typescript');
      expect(result).toContain('esbuild');
    });

    it('should return what a production install needs without dev and optional', async () => {
      for (const file of ['npm/package-lock.json', 'pnpm/pnpm-lock.yaml', 'bun/bun.lock']) {
        const lock = await load(file);

        expect(names(lock.getAll({ dev: false, optional: false }))).toEqual(production);
      }
    });

    it('should leave out prod packages', async () => {
      const lock = await load('npm/package-lock.json');
      const result = names(lock.getAll({ prod: false }));

      expect(result).toContain('typescript');
      expect(result).toContain('fsevents');
      expect(result).not.toContain('react');
    });

    it('should leave out peer packages', () => {
      const lock = new Lockfile('npm');
      lock.add('a', '1.0.0', { dev: false, optional: false, peer: false });
      lock.add('p', '1.0.0', { dev: false, optional: false, peer: true });

      expect(names(lock.getAll({ peer: false }))).toEqual(['a']);
    });

    it('should treat all yarn packages as prod', async () => {
      const lock = await load('yarn-v1/yarn.lock');

      expect(lock.getAll({ dev: false, optional: false, peer: false })).toHaveLength(lock.size);
      expect(lock.getAll({ prod: false })).toEqual([]);
    });
  });

  describe('dependenciesOf', () => {
    it('should return the entries a package depends on', async () => {
      const lock = await load('npm/package-lock.json');
      const reactDom = lock.get('react-dom', '18.3.1')!;

      expect(names(lock.dependenciesOf(reactDom))).toEqual(['loose-envify', 'react', 'scheduler']);
    });

    it('should skip dependencies that are not in the lockfile', () => {
      const lock = new Lockfile('npm');
      const a = lock.add('a', '1.0.0', { dependencies: ['b@1.0.0', 'missing@1.0.0'] });
      lock.add('b', '1.0.0');

      expect(names(lock.dependenciesOf(a))).toEqual(['b']);
    });
  });

  describe('dependentsOf', () => {
    it('should return the packages that depend on a package', async () => {
      const lock = await load('npm/package-lock.json');

      expect(names(lock.dependentsOf('js-tokens', '4.0.0'))).toEqual(['loose-envify']);
      expect(names(lock.dependentsOf('loose-envify', '1.4.0'))).toEqual([
        'react',
        'react-dom',
        'scheduler',
      ]);
    });

    it('should return an empty list for unknown or unused packages', async () => {
      const lock = await load('npm/package-lock.json');

      expect(lock.dependentsOf('react-dom', '18.3.1')).toEqual([]);
      expect(lock.dependentsOf('missing', '1.0.0')).toEqual([]);
    });

    it('should notice entries that are added later', () => {
      const lock = new Lockfile('npm');
      lock.add('a', '1.0.0');
      expect(lock.dependentsOf('a', '1.0.0')).toEqual([]);

      lock.add('b', '1.0.0', { dependencies: ['a@1.0.0'] });

      expect(names(lock.dependentsOf('a', '1.0.0'))).toEqual(['b']);
    });
  });

  describe('traverse', () => {
    const production = ['js-tokens', 'loose-envify', 'react', 'react-dom', 'scheduler'];

    it('should visit everything the importers depend on', async () => {
      const lock = await load('npm/package-lock.json');
      const visited = names(lock.traverse());

      expect(visited).toEqual(expect.arrayContaining([...production, 'typescript', 'esbuild']));
      expect(visited).toContain('fsevents');
      expect(visited).toContain('@esbuild/darwin-arm64');
      expect(new Set(visited).size).toBe(visited.length);
    });

    it('should leave out dev dependencies with dev: false', async () => {
      const lock = await load('npm/package-lock.json');
      const visited = names(lock.traverse({ dev: false }));

      expect(visited).toEqual(['fsevents', ...production]);
    });

    it('should leave out optional dependencies with optional: false', async () => {
      const lock = await load('npm/package-lock.json');
      const visited = names(lock.traverse({ optional: false }));

      expect(visited).toEqual(['esbuild', ...production, 'typescript']);
    });

    it('should leave out dev and optional dependencies when both are false', async () => {
      const lock = await load('npm/package-lock.json');

      expect(names(lock.traverse({ dev: false, optional: false }))).toEqual(production);
    });

    it('should start at the given entries', async () => {
      const lock = await load('npm/package-lock.json');
      const reactDom = lock.get('react-dom', '18.3.1')!;

      expect(names(lock.traverse({ from: [reactDom] }))).toEqual(production);
    });

    it('should work the same for pnpm and bun', async () => {
      for (const file of ['pnpm/pnpm-lock.yaml', 'bun/bun.lock']) {
        const lock = await load(file);

        expect(names(lock.traverse({ dev: false, optional: false }))).toEqual(production);
      }
    });

    it('should find nothing without importers (yarn classic)', async () => {
      const lock = await load('yarn-v1/yarn.lock');

      expect([...lock.traverse()]).toEqual([]);
    });

    it('should handle dependency cycles', () => {
      const lock = new Lockfile('npm');
      lock.add('a', '1.0.0', { dependencies: ['b@1.0.0'] });
      lock.add('b', '1.0.0', { dependencies: ['a@1.0.0'] });
      lock.importer('').dependencies.add('a@1.0.0');

      expect(names(lock.traverse())).toEqual(['a', 'b']);
    });
  });

  describe('duplicates', () => {
    it('should return packages with more than one version', () => {
      const lock = new Lockfile('npm');
      lock.add('a', '1.0.0');
      lock.add('a', '2.0.0');
      lock.add('b', '1.0.0');

      const duplicates = lock.duplicates();

      expect([...duplicates.keys()]).toEqual(['a']);
      expect(duplicates.get('a')!.map((e) => e.version)).toEqual(['1.0.0', '2.0.0']);
    });

    it('should be empty when every package has one version', async () => {
      const lock = await load('npm/package-lock.json');

      expect(lock.duplicates().size).toBe(0);
    });
  });

  describe('why', () => {
    it('should return every chain from an importer to the package', async () => {
      const lock = await load('npm/package-lock.json');

      const chains = lock.why('js-tokens', '4.0.0');

      expect(chains.map((chain) => chain.length)).toEqual([3, 3, 4, 4]);
      expect(chainNames(chains).sort()).toEqual([
        ['react', 'loose-envify', 'js-tokens'],
        ['react-dom', 'loose-envify', 'js-tokens'],
        ['react-dom', 'react', 'loose-envify', 'js-tokens'],
        ['react-dom', 'scheduler', 'loose-envify', 'js-tokens'],
      ]);
    });

    it('should return the shortest chain first', async () => {
      const lock = await load('npm/package-lock.json');

      expect(chainNames(lock.why('react', '18.3.1'))).toEqual([['react'], ['react-dom', 'react']]);
    });

    it('should explain dev and optional packages', async () => {
      const lock = await load('npm/package-lock.json');

      expect(chainNames(lock.why('@esbuild/darwin-arm64', '0.24.0'))).toEqual([
        ['esbuild', '@esbuild/darwin-arm64'],
      ]);
      expect(chainNames(lock.why('fsevents', '2.3.3'))).toEqual([['fsevents']]);
    });

    it('should respect the limit', async () => {
      const lock = await load('npm/package-lock.json');

      expect(lock.why('js-tokens', '4.0.0', { limit: 1 })).toHaveLength(1);
    });

    it('should return nothing for unknown packages', async () => {
      const lock = await load('npm/package-lock.json');

      expect(lock.why('missing', '1.0.0')).toEqual([]);
    });

    it('should return nothing without importers (yarn classic)', async () => {
      const lock = await load('yarn-v1/yarn.lock');

      expect(lock.why('js-tokens', '4.0.0')).toEqual([]);
    });

    it('should handle dependency cycles', () => {
      const lock = new Lockfile('npm');
      lock.add('a', '1.0.0', { dependencies: ['b@1.0.0'] });
      lock.add('b', '1.0.0', { dependencies: ['a@1.0.0'] });
      lock.importer('').dependencies.add('a@1.0.0');

      expect(chainNames(lock.why('b', '1.0.0'))).toEqual([['a', 'b']]);
    });
  });

  describe('toJSON', () => {
    it('should keep the data when stringified', async () => {
      const lock = await load('npm/package-lock.json');
      const json = JSON.parse(JSON.stringify(lock));

      expect(json.kind).toBe('npm');
      expect(json.lockfileVersion).toBe('3');
      expect(Object.keys(json.entries)).toHaveLength(lock.size);
      expect(json.entries['react-dom@18.3.1'].dependencies.sort()).toEqual([
        'loose-envify@1.4.0',
        'react@18.3.1',
        'scheduler@0.23.2',
      ]);
      expect(json.importers[''].devDependencies.sort()).toEqual([
        'esbuild@0.24.0',
        'typescript@5.6.3',
      ]);
    });

    it('should leave out fields that are not set', () => {
      const lock = new Lockfile('bun');
      lock.add('a', '1.0.0');

      const json = JSON.parse(JSON.stringify(lock));

      expect(json.lockfileVersion).toBeUndefined();
      expect(json.entries['a@1.0.0']).toEqual({
        name: 'a',
        version: '1.0.0',
        dependencies: [],
        optionalDependencies: [],
        peerDependencies: [],
        ranges: {},
      });
    });
  });
});
