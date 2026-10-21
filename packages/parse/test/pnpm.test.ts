import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parsePnpmLock } from '../src/pnpm.js';

const fixturesDir = join(import.meta.dirname, './fixtures');

const versions = [
  { dir: 'pnpm-v8', pnpmVersion: 8, lockfileVersion: '6.0', hasInstallScript: true },
  { dir: 'pnpm-v9', pnpmVersion: 9, lockfileVersion: '9.0', hasInstallScript: undefined },
  { dir: 'pnpm', pnpmVersion: 10, lockfileVersion: '9.0', hasInstallScript: undefined },
];

describe('pnpm lockfile parser', () => {
  for (const { dir, pnpmVersion, lockfileVersion, hasInstallScript } of versions) {
    describe(`pnpm v${pnpmVersion}`, () => {
      const load = async () =>
        parsePnpmLock(await readFile(join(fixturesDir, dir, 'pnpm-lock.yaml'), 'utf-8'));

      it(`should parse ${dir} pnpm-lock.yaml`, async () => {
        const lock = await load();

        expect(lock.kind).toBe('pnpm');
        expect(lock.lockfileVersion).toBe(lockfileVersion);
        expect(lock.entries.size).toBeGreaterThan(0);
      });

      it(`should extract package information from ${dir}`, async () => {
        const react = (await load()).get('react', '18.3.1')!;

        expect(react).toBeDefined();
        expect(react.integrity).toMatch(/^sha512-/);
        expect(react.source).toBe('registry');
        expect(react.engines).toEqual({ node: '>=0.10.0' });
      });

      it(`should extract the root project as importer in ${dir}`, async () => {
        const root = (await load()).importers.get('')!;

        expect([...root.dependencies].sort()).toEqual(['react-dom@18.3.1', 'react@18.3.1']);
        expect([...root.devDependencies].sort()).toEqual(['esbuild@0.24.0', 'typescript@5.6.3']);
        expect([...root.optionalDependencies]).toEqual(['fsevents@2.3.3']);
      });

      it(`should handle dependencies and peers in ${dir}`, async () => {
        const reactDom = (await load()).get('react-dom', '18.3.1')!;

        expect([...reactDom.dependencies].sort()).toEqual([
          'loose-envify@1.4.0',
          'react@18.3.1',
          'scheduler@0.23.2',
        ]);
        expect([...reactDom.peerDependencies]).toEqual(['react@18.3.1']);
      });

      it(`should mark dev and optional packages in ${dir}`, async () => {
        const lock = await load();

        expect(lock.get('react', '18.3.1')).toMatchObject({ dev: false, optional: false });
        expect(lock.get('typescript', '5.6.3')).toMatchObject({ dev: true, optional: false });
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

      it(`should extract optional dependencies of a package in ${dir}`, async () => {
        const esbuild = (await load()).get('esbuild', '0.24.0')!;

        expect(esbuild.optionalDependencies.size).toBeGreaterThan(20);
        expect(esbuild.optionalDependencies).toContain('@esbuild/darwin-arm64@0.24.0');
        expect(esbuild.hasInstallScript).toBe(hasInstallScript);
      });
    });
  }

  it('should throw error for invalid YAML', () => {
    expect(() => parsePnpmLock('not valid yaml: [unclosed')).toThrow();
  });

  it('should throw error for non-pnpm lockfile', () => {
    expect(() => parsePnpmLock('valid: yaml\nbut: not-pnpm')).toThrow(/pnpm/);
  });

  it('should throw error for old lockfile versions', () => {
    expect(() => parsePnpmLock("lockfileVersion: '5.4'\npackages: {}")).toThrow(/not supported/);
  });
});
