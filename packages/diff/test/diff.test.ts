import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Lockfile, parseLockfile } from '@lockfiles/parse';
import { describe, expect, it } from 'vitest';
import { diffLockfileFiles, diffLockfiles } from '../src/index.js';

const fixturesDir = join(import.meta.dirname, './fixtures');
const fixture = (file: string) => join(fixturesDir, file);
const names = (entries: { name: string }[]) => entries.map((e) => e.name);

describe('diffLockfiles with real lockfiles', () => {
  it('should find added, removed and updated packages', async () => {
    const diff = await diffLockfileFiles(
      fixture('before/package-lock.json'),
      fixture('after/package-lock.json'),
    );

    expect(diff.isEmpty).toBe(false);
    expect(diff.added.map((e) => `${e.name}@${e.version}`)).toEqual(['semver@7.6.3']);
    expect(diff.removed.map((e) => `${e.name}@${e.version}`)).toEqual(['lodash@4.17.20']);
    expect(names(diff.changed)).toEqual(['picocolors', 'react', 'react-dom', 'typescript']);
    expect(diff.integrityChanged).toEqual([]);
  });

  it('should tell the direction and size of an update', async () => {
    const { changed } = await diffLockfileFiles(
      fixture('before/package-lock.json'),
      fixture('after/package-lock.json'),
    );

    const react = changed.find((c) => c.name === 'react')!;
    expect(react.before.map((e) => e.version)).toEqual(['18.2.0']);
    expect(react.after.map((e) => e.version)).toEqual(['18.3.1']);
    expect(react).toMatchObject({ direction: 'upgrade', bump: 'minor' });
    expect(changed.find((c) => c.name === 'picocolors')).toMatchObject({
      direction: 'downgrade',
      bump: 'minor',
    });
  });

  it('should find nothing when a lockfile is compared with itself', async () => {
    const lockfile = await parseLockfile(fixture('after/package-lock.json'));

    expect(diffLockfiles(lockfile, lockfile).isEmpty).toBe(true);
  });

  it('should compare lockfiles of different package managers', async () => {
    const npmAfter = fixture('after/package-lock.json');
    const pnpmAfter = fixture('after-pnpm/pnpm-lock.yaml');

    expect((await diffLockfileFiles(npmAfter, pnpmAfter)).isEmpty).toBe(true);

    const withNpm = await diffLockfileFiles(fixture('before/package-lock.json'), npmAfter);
    const withPnpm = await diffLockfileFiles(fixture('before/package-lock.json'), pnpmAfter);
    expect(names(withPnpm.changed)).toEqual(names(withNpm.changed));
    expect(names(withPnpm.added)).toEqual(names(withNpm.added));
    expect(names(withPnpm.removed)).toEqual(names(withNpm.removed));
  });

  it('should accept the content of a lockfile', async () => {
    const [before, after] = await Promise.all([
      readFile(fixture('before/package-lock.json'), 'utf-8'),
      readFile(fixture('after-pnpm/pnpm-lock.yaml'), 'utf-8'),
    ]);

    const diff = await diffLockfileFiles(before, after);

    expect(names(diff.changed)).toContain('react');
  });

  it('should reject when a path does not exist', async () => {
    await expect(
      diffLockfileFiles(fixture('missing/package-lock.json'), fixture('after/package-lock.json')),
    ).rejects.toThrow(/ENOENT/);
  });

  it('should leave out dev packages with dev: false', async () => {
    const diff = await diffLockfileFiles(
      fixture('before/package-lock.json'),
      fixture('after/package-lock.json'),
      { dev: false },
    );

    expect(names(diff.changed)).toEqual(['picocolors', 'react', 'react-dom']);
  });

  it('should only compare dev packages with prod: false', async () => {
    const diff = await diffLockfileFiles(
      fixture('before/package-lock.json'),
      fixture('after/package-lock.json'),
      { prod: false },
    );

    expect(names(diff.changed)).toEqual(['typescript']);
    expect(diff.added).toEqual([]);
    expect(diff.removed).toEqual([]);
  });
});

describe('diffLockfiles with small lockfiles', () => {
  const build = (...packages: [name: string, version: string, extra?: object][]) => {
    const lockfile = new Lockfile('npm');
    for (const [name, version, extra] of packages) lockfile.add(name, version, extra);
    return lockfile;
  };

  it('should list every version of an added or removed package', () => {
    const diff = diffLockfiles(
      build(['old', '1.0.0'], ['old', '2.0.0']),
      build(['new', '2.0.0'], ['new', '1.0.0']),
    );

    expect(diff.removed.map((e) => e.version)).toEqual(['1.0.0', '2.0.0']);
    expect(diff.added.map((e) => e.version)).toEqual(['1.0.0', '2.0.0']);
  });

  it('should only list the versions that differ', () => {
    const { changed } = diffLockfiles(
      build(['a', '1.0.0'], ['a', '2.0.0']),
      build(['a', '2.0.0'], ['a', '3.0.0']),
    );

    expect(changed).toHaveLength(1);
    expect(changed[0]!.before.map((e) => e.version)).toEqual(['1.0.0']);
    expect(changed[0]!.after.map((e) => e.version)).toEqual(['3.0.0']);
    expect(changed[0]).toMatchObject({ direction: 'upgrade', bump: 'major' });
  });

  it('should not set a direction when there is more than one version on a side', () => {
    const { changed } = diffLockfiles(build(['a', '1.0.0'], ['a', '2.0.0']), build(['a', '3.0.0']));

    expect(changed[0]!.before).toHaveLength(2);
    expect(changed[0]!.direction).toBeUndefined();
    expect(changed[0]!.bump).toBeUndefined();
  });

  it('should handle prereleases and versions that are not semver', () => {
    const { changed } = diffLockfiles(
      build(['pre', '1.0.0-beta.1'], ['git', 'abc123']),
      build(['pre', '1.0.0'], ['git', 'def456']),
    );

    expect(changed.find((c) => c.name === 'pre')).toMatchObject({
      direction: 'upgrade',
      bump: 'prerelease',
    });
    expect(changed.find((c) => c.name === 'git')!.direction).toBeUndefined();
  });

  it('should find a different integrity hash for the same version', () => {
    const diff = diffLockfiles(
      build(['a', '1.0.0', { integrity: 'sha512-old' }]),
      build(['a', '1.0.0', { integrity: 'sha512-new' }]),
    );

    expect(diff.integrityChanged).toHaveLength(1);
    expect(diff.integrityChanged[0]!.before.integrity).toBe('sha512-old');
    expect(diff.integrityChanged[0]!.after.integrity).toBe('sha512-new');
    expect(diff.changed).toEqual([]);
    expect(diff.isEmpty).toBe(false);
  });

  it('should not compare the integrity if one lockfile has none', () => {
    const diff = diffLockfiles(
      build(['a', '1.0.0', { integrity: 'sha512-old' }]),
      build(['a', '1.0.0']),
    );

    expect(diff.integrityChanged).toEqual([]);
    expect(diff.isEmpty).toBe(true);
  });

  it('should ignore workspace packages', () => {
    const diff = diffLockfiles(
      build(['@project/lib', '1.0.0', { source: 'workspace' }], ['a', '1.0.0']),
      build(['@project/lib', '2.0.0', { source: 'workspace' }], ['a', '1.0.0']),
    );

    expect(diff.isEmpty).toBe(true);
  });

  it('should sort the result by name and version', () => {
    const diff = diffLockfiles(build(), build(['b', '1.0.0'], ['a', '10.0.0'], ['a', '2.0.0']));

    expect(diff.added.map((e) => `${e.name}@${e.version}`)).toEqual([
      'a@2.0.0',
      'a@10.0.0',
      'b@1.0.0',
    ]);
  });
});
