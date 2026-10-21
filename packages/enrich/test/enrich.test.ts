import { join } from 'node:path';
import { Lockfile } from '@lockfiles/parse';
import { afterEach, describe, expect, it } from 'vitest';
import { enrich } from '../src/index.js';
import {
  createProject,
  fixturesDir,
  loadFixture,
  mockRegistry,
  names,
  PRODUCTION,
} from './helpers.js';

const removers: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(removers.splice(0).map((remove) => remove()));
});

describe('enrich with all steps', () => {
  it('should combine project files, node_modules and the registry', async () => {
    const registry = mockRegistry();
    const lockfile = await loadFixture('yarn-berry/yarn.lock');

    const report = await enrich(lockfile, {
      projectDir: join(fixturesDir, 'yarn-berry'),
      registry: { fetch: registry.fetch },
    });

    expect(names(lockfile.getAll({ dev: false, optional: false }))).toEqual(PRODUCTION);
    expect(report.sources.get('react@18.3.1')).toEqual({
      dev: 'project',
      optional: 'project',
      integrity: 'registry',
      resolved: 'registry',
      license: 'registry',
      engines: 'registry',
    });
    expect(report.filled.integrity).toBeGreaterThan(0);
  });

  it('should not let the registry replace what node_modules gave', async () => {
    const created = await createProject({
      'node_modules/react/package.json': {
        name: 'react',
        version: '18.3.1',
        license: 'from-node-modules',
      },
    });
    removers.push(created.remove);
    const registry = mockRegistry();
    const lockfile = await loadFixture('yarn-v1/yarn.lock');

    const report = await enrich(lockfile, {
      projectDir: created.dir,
      project: false,
      registry: { fetch: registry.fetch },
    });

    expect(lockfile.get('react', '18.3.1')!.license).toBe('from-node-modules');
    expect(report.sources.get('react@18.3.1')!.license).toBe('node_modules');
  });

  it('should still ask the registry for what only it knows', async () => {
    const created = await createProject({
      'node_modules/react/package.json': {
        name: 'react',
        version: '18.3.1',
        license: 'from-node-modules',
      },
    });
    removers.push(created.remove);
    const registry = mockRegistry();
    const lockfile = new Lockfile('pnpm');
    lockfile.add('react', '18.3.1', { source: 'registry' });
    lockfile.add('loose-envify', '1.4.0', { source: 'registry' });

    await enrich(lockfile, {
      projectDir: created.dir,
      project: false,
      registry: { fetch: registry.fetch },
    });

    // pnpm doesn't store the download link, so both packages are asked for it.
    expect(registry.requests).toHaveLength(2);
    expect(lockfile.get('react', '18.3.1')).toMatchObject({
      license: 'from-node-modules',
      resolved: 'https://registry.npmjs.org/react/-/react-18.3.1.tgz',
    });
    expect(lockfile.get('loose-envify', '1.4.0')).toMatchObject({
      license: 'MIT',
      bin: { 'loose-envify': 'cli.js' },
    });
  });

  it('should return an empty report when there is nothing to do', async () => {
    const lockfile = await loadFixture('npm/package-lock.json');

    const report = await enrich(lockfile, { projectDir: join(fixturesDir, 'npm') });

    expect(report.filled).toEqual({});
    expect(report.unresolved).toEqual([]);
    expect(report.failed).toEqual([]);
    expect(report.sources.size).toBe(0);
  });
});
