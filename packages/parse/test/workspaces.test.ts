import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseLockfile, type LockEntry } from '../src/index.js';

const workspacesDir = join(import.meta.dirname, './fixtures/workspaces');
const load = (file: string) => parseLockfile(join(workspacesDir, file));
const names = (entries: Iterable<LockEntry>) => [...entries].map((e) => e.name).sort();
const chainNames = (chains: LockEntry[][]) => chains.map((chain) => chain.map((e) => e.name));

// The fixture has a root with `typescript` (dev), `packages/app` with `react`, `fsevents` (optional)
// and a dependency on `packages/lib`, and `packages/lib` with `js-tokens` and `scheduler`.
const production = ['js-tokens', 'loose-envify', 'react', 'scheduler'];

const withFlags = [
  { name: 'npm', file: 'npm/package-lock.json', hasNames: true },
  { name: 'pnpm 8', file: 'pnpm-v8/pnpm-lock.yaml', hasNames: false },
  { name: 'pnpm 10', file: 'pnpm/pnpm-lock.yaml', hasNames: false },
  { name: 'bun', file: 'bun/bun.lock', hasNames: true },
];

describe('workspace lockfiles', () => {
  for (const { name, file, hasNames } of withFlags) {
    describe(name, () => {
      it('should find the root and every workspace as importer', async () => {
        const lock = await load(file);

        expect([...lock.importers.keys()].sort()).toEqual(['', 'packages/app', 'packages/lib']);
      });

      it('should keep the dependencies of each importer apart', async () => {
        const { importers } = await load(file);

        expect([...importers.get('')!.devDependencies]).toEqual(['typescript@5.6.3']);
        expect(importers.get('')!.dependencies.size).toBe(0);
        expect([...importers.get('packages/app')!.dependencies]).toContain('react@18.3.1');
        expect([...importers.get('packages/app')!.optionalDependencies]).toEqual([
          'fsevents@2.3.3',
        ]);
        expect([...importers.get('packages/lib')!.dependencies].sort()).toEqual([
          'js-tokens@3.0.2',
          'scheduler@0.23.2',
        ]);
      });

      it('should read workspace names and versions where the lockfile has them', async () => {
        const { importers } = await load(file);

        if (hasNames) {
          expect(importers.get('')!.name).toBe('workspace-fixture');
          expect(importers.get('packages/app')).toMatchObject({
            name: '@fixture/app',
            version: '1.0.0',
          });
          expect(importers.get('packages/lib')).toMatchObject({
            name: '@fixture/lib',
            version: '1.2.0',
          });
        } else {
          expect(importers.get('packages/lib')!.name).toBeUndefined();
        }
      });

      it('should mark dev and optional packages across workspaces', async () => {
        const lock = await load(file);

        expect(lock.get('typescript', '5.6.3')).toMatchObject({ dev: true, optional: false });
        expect(lock.get('fsevents', '2.3.3')).toMatchObject({ dev: false, optional: true });
        expect(lock.get('scheduler', '0.23.2')).toMatchObject({ dev: false, optional: false });
        expect(lock.get('js-tokens', '3.0.2')).toMatchObject({ dev: false, optional: false });
      });

      it('should return what a production install of all workspaces needs', async () => {
        const lock = await load(file);

        expect(names(lock.traverse({ dev: false, optional: false }))).toEqual(production);
      });

      it('should explain packages through the workspace that needs them', async () => {
        const lock = await load(file);

        expect(chainNames(lock.why('scheduler', '0.23.2'))).toEqual([['scheduler']]);
        expect(chainNames(lock.why('loose-envify', '1.4.0')).sort()).toEqual([
          ['react', 'loose-envify'],
          ['scheduler', 'loose-envify'],
        ]);
      });
    });
  }

  describe('workspace packages as entries', () => {
    it('should list workspace packages as entries for npm only', async () => {
      const npm = await load('npm/package-lock.json');

      expect(npm.get('@fixture/lib', '1.2.0')).toMatchObject({ source: 'workspace' });
      expect(npm.get('@fixture/app', '1.0.0')).toMatchObject({ source: 'workspace' });

      for (const file of ['pnpm/pnpm-lock.yaml', 'bun/bun.lock', 'yarn-berry/yarn.lock']) {
        const lock = await load(file);

        expect(lock.versionsOf('@fixture/lib')).toEqual([]);
        expect(lock.versionsOf('@fixture/app')).toEqual([]);
      }
    });
  });

  describe('yarn berry', () => {
    it('should find the root and every workspace as importer', async () => {
      const lock = await load('yarn-berry/yarn.lock');

      expect([...lock.importers.keys()].sort()).toEqual(['', 'packages/app', 'packages/lib']);
      expect(lock.importers.get('packages/app')).toMatchObject({ name: '@fixture/app' });
      expect(lock.importers.get('packages/app')!.version).toBeUndefined();
    });

    it('should keep the dependencies of each importer apart', async () => {
      const { importers } = await load('yarn-berry/yarn.lock');

      expect([...importers.get('')!.dependencies]).toEqual(['typescript@5.6.3']);
      expect([...importers.get('packages/app')!.dependencies]).toEqual(['react@18.3.1']);
      expect([...importers.get('packages/app')!.optionalDependencies]).toEqual(['fsevents@2.3.3']);
      expect([...importers.get('packages/lib')!.dependencies].sort()).toEqual([
        'js-tokens@3.0.2',
        'scheduler@0.23.2',
      ]);
    });

    it('should list packages that yarn installs in more than one version', async () => {
      const duplicates = (await load('yarn-berry/yarn.lock')).duplicates();

      expect(
        duplicates
          .get('js-tokens')!
          .map((e) => e.version)
          .sort(),
      ).toEqual(['3.0.2', '4.0.0']);
    });
  });

  describe('yarn classic', () => {
    it('should have no importers and keep both versions of a package', async () => {
      const lock = await load('yarn-v1/yarn.lock');

      expect(lock.importers.size).toBe(0);
      expect(lock.versionsOf('js-tokens').sort()).toEqual(['3.0.2', '4.0.0']);
      expect(lock.duplicates().has('js-tokens')).toBe(true);
    });
  });
});
