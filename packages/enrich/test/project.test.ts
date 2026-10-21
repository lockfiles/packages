import { join } from 'node:path';
import { Lockfile } from '@lockfiles/parse';
import { afterEach, describe, expect, it } from 'vitest';
import { enrich } from '../src/index.js';
import { createProject, fixturesDir, loadFixture, names, PRODUCTION } from './helpers.js';

const projects: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(projects.splice(0).map((remove) => remove()));
});

const options = (dir: string) => ({ projectDir: dir, nodeModules: false });

describe('dev and optional flags from package.json', () => {
  for (const file of ['yarn-v1', 'yarn-berry']) {
    describe(file, () => {
      const run = async () => {
        const lockfile = await loadFixture(`${file}/yarn.lock`);
        const report = await enrich(lockfile, options(join(fixturesDir, file)));
        return { lockfile, report };
      };

      it('should mark dev and optional packages', async () => {
        const { lockfile } = await run();

        expect(lockfile.get('react', '18.3.1')).toMatchObject({ dev: false, optional: false });
        expect(lockfile.get('loose-envify', '1.4.0')).toMatchObject({
          dev: false,
          optional: false,
        });
        expect(lockfile.get('typescript', '5.6.3')).toMatchObject({ dev: true, optional: false });
        expect(lockfile.get('esbuild', '0.24.0')).toMatchObject({ dev: true, optional: false });
        expect(lockfile.get('fsevents', '2.3.3')).toMatchObject({ dev: false, optional: true });
        expect(lockfile.get('@esbuild/darwin-arm64', '0.24.0')).toMatchObject({
          dev: true,
          optional: true,
        });
      });

      it('should find what a production install needs', async () => {
        const { lockfile } = await run();

        expect(names(lockfile.getAll({ dev: false, optional: false }))).toEqual(PRODUCTION);
      });

      it('should create the importer of the project from its package.json', async () => {
        const { lockfile } = await run();
        const root = lockfile.importers.get('')!;

        expect(root.name).toBe('fixture');
        expect([...root.dependencies].sort()).toEqual(['react-dom@18.3.1', 'react@18.3.1']);
        expect([...root.devDependencies].sort()).toEqual(['esbuild@0.24.0', 'typescript@5.6.3']);
        expect([...root.optionalDependencies]).toEqual(['fsevents@2.3.3']);
      });

      it('should make traverse and why work', async () => {
        const { lockfile } = await run();

        expect(names(lockfile.traverse({ dev: false, optional: false }))).toEqual(PRODUCTION);
        expect(lockfile.why('js-tokens', '4.0.0').length).toBeGreaterThan(0);
      });

      it('should report what was filled and where it came from', async () => {
        const { lockfile, report } = await run();

        expect(report.filled.dev).toBe(lockfile.size);
        expect(report.filled.optional).toBe(lockfile.size);
        expect(report.sources.get('react@18.3.1')).toEqual({ dev: 'project', optional: 'project' });
        expect(report.unresolved).toEqual([]);
        expect(report.failed).toEqual([]);
      });
    });
  }
});

describe('workspaces', () => {
  for (const file of ['yarn-v1', 'yarn-berry']) {
    describe(file, () => {
      const run = async () => {
        const lockfile = await loadFixture(`workspaces/${file}/yarn.lock`);
        const report = await enrich(lockfile, options(join(fixturesDir, 'workspaces', file)));
        return { lockfile, report };
      };

      it('should read the package.json of every workspace', async () => {
        const { lockfile, report } = await run();
        const { importers } = lockfile;

        expect([...importers.keys()].sort()).toEqual(['', 'packages/app', 'packages/lib']);
        expect(importers.get('packages/app')).toMatchObject({
          name: '@fixture/app',
          version: '1.0.0',
        });
        expect([...importers.get('')!.devDependencies]).toEqual(['typescript@5.6.3']);
        expect([...importers.get('packages/app')!.dependencies]).toEqual(['react@18.3.1']);
        expect([...importers.get('packages/app')!.optionalDependencies]).toEqual([
          'fsevents@2.3.3',
        ]);
        expect([...importers.get('packages/lib')!.dependencies].sort()).toEqual([
          'js-tokens@3.0.2',
          'scheduler@0.23.2',
        ]);
        expect(report.unresolved).toEqual([]);
      });

      it('should mark dev and optional packages across workspaces', async () => {
        const { lockfile } = await run();

        expect(lockfile.get('typescript', '5.6.3')).toMatchObject({ dev: true, optional: false });
        expect(lockfile.get('fsevents', '2.3.3')).toMatchObject({ dev: false, optional: true });
        expect(lockfile.get('scheduler', '0.23.2')).toMatchObject({ dev: false, optional: false });
        expect(lockfile.get('js-tokens', '3.0.2')).toMatchObject({ dev: false, optional: false });
        expect(lockfile.get('js-tokens', '4.0.0')).toMatchObject({ dev: false, optional: false });
      });
    });
  }
});

describe('project files', () => {
  it('should find workspaces in pnpm-workspace.yaml and skip excluded ones', async () => {
    const project = await createProject({
      'package.json': { name: 'root', devDependencies: { tool: '^1.0.0' } },
      'pnpm-workspace.yaml': "packages:\n  - 'apps/*'\n  - '!apps/legacy'\n",
      'apps/web/package.json': { name: 'web', dependencies: { lib: '^1.0.0' } },
      'apps/legacy/package.json': { name: 'legacy', dependencies: { old: '^1.0.0' } },
    });
    projects.push(project.remove);
    const lockfile = new Lockfile('yarn');
    lockfile.add('tool', '1.0.0');
    lockfile.add('lib', '1.0.0');
    lockfile.add('old', '1.0.0');
    lockfile.descriptors.set('tool@^1.0.0', 'tool@1.0.0');
    lockfile.descriptors.set('lib@^1.0.0', 'lib@1.0.0');
    lockfile.descriptors.set('old@^1.0.0', 'old@1.0.0');

    await enrich(lockfile, options(project.dir));

    expect([...lockfile.importers.keys()].sort()).toEqual(['', 'apps/web']);
    expect(lockfile.get('tool', '1.0.0')!.dev).toBe(true);
    expect(lockfile.get('lib', '1.0.0')!.dev).toBe(false);
  });

  it('should find workspaces in the workspaces field of package.json', async () => {
    const project = await createProject({
      'package.json': { name: 'root', workspaces: { packages: ['libs/*'] } },
      'libs/a/package.json': { name: 'a', dependencies: { dep: '1.0.0' } },
    });
    projects.push(project.remove);
    const lockfile = new Lockfile('yarn');
    lockfile.add('dep', '1.0.0');
    lockfile.descriptors.set('dep@1.0.0', 'dep@1.0.0');

    await enrich(lockfile, options(project.dir));

    expect([...lockfile.importers.keys()].sort()).toEqual(['', 'libs/a']);
    expect(lockfile.get('dep', '1.0.0')!.dev).toBe(false);
  });

  it('should list dependencies that are not in the lockfile', async () => {
    const project = await createProject({
      'package.json': { name: 'root', dependencies: { missing: '^1.0.0', local: 'workspace:*' } },
    });
    projects.push(project.remove);
    const lockfile = new Lockfile('yarn');

    const report = await enrich(lockfile, options(project.dir));

    expect(report.unresolved).toEqual(['.: missing@^1.0.0']);
  });

  it('should resolve npm: aliases', async () => {
    const project = await createProject({
      'package.json': { name: 'root', devDependencies: { alias: 'npm:real@^2.0.0' } },
    });
    projects.push(project.remove);
    const lockfile = new Lockfile('yarn');
    lockfile.add('real', '2.1.0');
    lockfile.descriptors.set('real@npm:^2.0.0', 'real@2.1.0');

    const report = await enrich(lockfile, options(project.dir));

    expect(report.unresolved).toEqual([]);
    expect(lockfile.get('real', '2.1.0')!.dev).toBe(true);
  });

  it('should do nothing without a package.json', async () => {
    const project = await createProject({ 'readme.txt': 'nothing here' });
    projects.push(project.remove);
    const lockfile = await loadFixture('yarn-v1/yarn.lock');

    const report = await enrich(lockfile, options(project.dir));

    expect(report.filled).toEqual({});
    expect(lockfile.importers.size).toBe(0);
    expect(lockfile.get('react', '18.3.1')!.dev).toBeUndefined();
  });

  it('should leave out this step with project: false', async () => {
    const lockfile = await loadFixture('yarn-v1/yarn.lock');

    const report = await enrich(lockfile, {
      projectDir: join(fixturesDir, 'yarn-v1'),
      project: false,
      nodeModules: false,
    });

    expect(report.filled).toEqual({});
    expect(lockfile.get('react', '18.3.1')!.dev).toBeUndefined();
  });

  it('should not touch lockfiles that already have the flags', async () => {
    for (const file of ['npm/package-lock.json', 'pnpm/pnpm-lock.yaml', 'bun/bun.lock']) {
      const lockfile = await loadFixture(file);
      const before = JSON.stringify(lockfile);

      const report = await enrich(lockfile, options(join(fixturesDir, file.split('/')[0]!)));

      expect(report.filled.dev).toBeUndefined();
      expect(JSON.stringify(lockfile)).toBe(before);
    }
  });
});
