import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  findAndParseLock,
  findAndParseLockSync,
  findLockfile,
  findLockfileSync,
  parseLockfile,
  parseLockfileSync,
} from '../src/index.js';

const fixturesDir = join(import.meta.dirname, './fixtures');

const fixtures = [
  { file: 'npm/package-lock.json', kind: 'npm' },
  { file: 'pnpm-v8/pnpm-lock.yaml', kind: 'pnpm' },
  { file: 'pnpm-v9/pnpm-lock.yaml', kind: 'pnpm' },
  { file: 'pnpm/pnpm-lock.yaml', kind: 'pnpm' },
  { file: 'yarn-v1/yarn.lock', kind: 'yarn' },
  { file: 'yarn-berry/yarn.lock', kind: 'yarn' },
  { file: 'bun/bun.lock', kind: 'bun' },
];

describe('parseLockfile', () => {
  for (const { file, kind } of fixtures) {
    it(`should parse ${file} from a path`, async () => {
      const lock = await parseLockfile(join(fixturesDir, file));

      expect(lock.kind).toBe(kind);
      expect(lock.get('react', '18.3.1')).toBeDefined();
    });

    it(`should detect and parse the contents of ${file}`, async () => {
      const content = await readFile(join(fixturesDir, file), 'utf-8');
      const lock = await parseLockfile(content);

      expect(lock.kind).toBe(kind);
      expect(lock.get('react', '18.3.1')).toBeDefined();
    });
  }

  it('should distinguish yarn classic from yarn berry', async () => {
    const classic = await parseLockfile(join(fixturesDir, 'yarn-v1/yarn.lock'));
    const berry = await parseLockfile(join(fixturesDir, 'yarn-berry/yarn.lock'));

    expect(classic.lockfileVersion).toBe('1');
    expect(berry.lockfileVersion).toBe('10');
  });

  it('should reject when the path does not exist', async () => {
    await expect(parseLockfile(join(fixturesDir, 'missing/package-lock.json'))).rejects.toThrow(
      /ENOENT/,
    );
  });
});

describe('parseLockfileSync', () => {
  for (const { file, kind } of fixtures) {
    it(`should parse ${file} from a path`, () => {
      const lock = parseLockfileSync(join(fixturesDir, file));

      expect(lock.kind).toBe(kind);
      expect(lock.get('react', '18.3.1')).toBeDefined();
    });

    it(`should detect and parse the contents of ${file}`, () => {
      const lock = parseLockfileSync(readFileSync(join(fixturesDir, file), 'utf-8'));

      expect(lock.kind).toBe(kind);
      expect(lock.get('react', '18.3.1')).toBeDefined();
    });
  }

  it('should throw when the path does not exist', () => {
    expect(() => parseLockfileSync(join(fixturesDir, 'missing/package-lock.json'))).toThrow(
      /ENOENT/,
    );
  });
});

describe('findLockfile', () => {
  let root: string;

  beforeEach(async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), 'lockfiles-parse-')));
    await mkdir(join(root, 'packages/app'), { recursive: true });
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('should find the lockfile in the given directory', async () => {
    await writeFile(join(root, 'bun.lock'), '');

    expect(await findLockfile(root)).toBe(join(root, 'bun.lock'));
  });

  it('should not look at parent directories by default', async () => {
    await writeFile(join(root, 'pnpm-lock.yaml'), '');

    expect(await findLockfile(join(root, 'packages/app'))).toBeUndefined();
  });

  it('should find the lockfile of a parent directory with searchParents', async () => {
    await writeFile(join(root, 'pnpm-lock.yaml'), '');

    expect(await findLockfile(join(root, 'packages/app'), { searchParents: true })).toBe(
      join(root, 'pnpm-lock.yaml'),
    );
  });

  it('should prefer the closest lockfile with searchParents', async () => {
    await writeFile(join(root, 'package-lock.json'), '');
    await writeFile(join(root, 'packages/app/yarn.lock'), '');

    expect(await findLockfile(join(root, 'packages/app'), { searchParents: true })).toBe(
      join(root, 'packages/app/yarn.lock'),
    );
  });

  it('should prefer package-lock.json over other lockfiles in the same directory', async () => {
    await writeFile(join(root, 'yarn.lock'), '');
    await writeFile(join(root, 'package-lock.json'), '');

    expect(await findLockfile(root)).toBe(join(root, 'package-lock.json'));
  });

  it('should return undefined when there is no lockfile', async () => {
    expect(await findLockfile(join(root, 'packages/app'), { searchParents: true })).toBeUndefined();
  });

  it('should find a lockfile that can be parsed', async () => {
    const file = await findLockfile(join(fixturesDir, 'npm'));

    expect(file).toBe(join(fixturesDir, 'npm/package-lock.json'));
    expect((await parseLockfile(file!)).kind).toBe('npm');
  });

  describe('sync', () => {
    it('should find the lockfile in the given directory', async () => {
      await writeFile(join(root, 'bun.lock'), '');

      expect(findLockfileSync(root)).toBe(join(root, 'bun.lock'));
    });

    it('should not look at parent directories by default', async () => {
      await writeFile(join(root, 'pnpm-lock.yaml'), '');

      expect(findLockfileSync(join(root, 'packages/app'))).toBeUndefined();
    });

    it('should find the lockfile of a parent directory with searchParents', async () => {
      await writeFile(join(root, 'pnpm-lock.yaml'), '');

      expect(findLockfileSync(join(root, 'packages/app'), { searchParents: true })).toBe(
        join(root, 'pnpm-lock.yaml'),
      );
    });

    it('should prefer package-lock.json over other lockfiles in the same directory', async () => {
      await writeFile(join(root, 'yarn.lock'), '');
      await writeFile(join(root, 'package-lock.json'), '');

      expect(findLockfileSync(root)).toBe(join(root, 'package-lock.json'));
    });

    it('should return undefined when there is no lockfile', () => {
      expect(findLockfileSync(join(root, 'packages/app'), { searchParents: true })).toBeUndefined();
    });
  });
});

describe('findAndParseLock', () => {
  const npmDir = join(fixturesDir, 'npm');
  let root: string;

  beforeEach(async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), 'lockfiles-parse-')));
    await mkdir(join(root, 'packages/app'), { recursive: true });
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('should find and parse the lockfile', async () => {
    const lock = await findAndParseLock(npmDir);

    expect(lock?.kind).toBe('npm');
    expect(lock?.get('react', '18.3.1')).toBeDefined();
  });

  it('should return undefined when there is no lockfile', async () => {
    expect(await findAndParseLock(join(root, 'packages/app'))).toBeUndefined();
  });

  it('should pass searchParents on', async () => {
    await writeFile(join(root, 'bun.lock'), await readFile(join(fixturesDir, 'bun/bun.lock')));
    const dir = join(root, 'packages/app');

    expect(await findAndParseLock(dir)).toBeUndefined();
    expect((await findAndParseLock(dir, { searchParents: true }))?.kind).toBe('bun');
  });

  it('should reject when the lockfile is invalid', async () => {
    await writeFile(join(root, 'package-lock.json'), 'not valid json');

    await expect(findAndParseLock(root)).rejects.toThrow(/JSON/);
  });

  describe('sync', () => {
    it('should find and parse the lockfile', () => {
      const lock = findAndParseLockSync(npmDir);

      expect(lock?.kind).toBe('npm');
      expect(lock?.get('react', '18.3.1')).toBeDefined();
    });

    it('should return undefined when there is no lockfile', () => {
      expect(findAndParseLockSync(join(root, 'packages/app'))).toBeUndefined();
    });

    it('should pass searchParents on', async () => {
      await writeFile(join(root, 'bun.lock'), await readFile(join(fixturesDir, 'bun/bun.lock')));
      const dir = join(root, 'packages/app');

      expect(findAndParseLockSync(dir)).toBeUndefined();
      expect(findAndParseLockSync(dir, { searchParents: true })?.kind).toBe('bun');
    });
  });
});
