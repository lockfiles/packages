import { access, readFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { parseBunLock } from './bun.js';
import { parseNpmLock } from './npm.js';
import { parsePnpmLock } from './pnpm.js';
import { parseYarnLock } from './yarn.js';
import type { Lockfile } from './lockfile.js';

export { Lockfile, keyOf } from './lockfile.js';
export { inferScopes } from './util.js';
export type {
  DependencyType,
  GetAllOptions,
  Importer,
  LockEntry,
  LockfileJSON,
  PackageManager,
  Source,
  TraverseOptions,
} from './lockfile.js';

type Parser = (text: string) => Lockfile;

const PARSER_BY_FILENAME: Record<string, Parser> = {
  'package-lock.json': parseNpmLock,
  'npm-shrinkwrap.json': parseNpmLock,
  'pnpm-lock.yaml': parsePnpmLock,
  'yarn.lock': parseYarnLock,
  'bun.lock': parseBunLock,
};

function detectParser(text: string): Parser {
  if (text.trimStart().startsWith('{')) {
    try {
      const { packages } = JSON.parse(text) as {
        packages?: Record<string, unknown>;
      };
      const first = Object.values(packages ?? {})[0];
      return Array.isArray(first) ? parseBunLock : parseNpmLock;
    } catch {
      // bun.lock is JSONC and contains trailing commas, which JSON.parse rejects.
      // so we fall back to parseBunLock as best effort. fingers crossed.
      return parseBunLock;
    }
  }
  return /^lockfileVersion:/m.test(text) ? parsePnpmLock : parseYarnLock;
}

const isContent = (input: string): boolean =>
  input.includes('\n') || input.trimStart().startsWith('{');

function parseText(text: string, file?: string): Lockfile {
  const parse = (file && PARSER_BY_FILENAME[path.basename(file)]) || detectParser(text);
  return parse(text);
}

function* nextFile(startDir: string, searchParents: boolean): Generator<string> {
  for (let dir = path.resolve(startDir); ; dir = path.dirname(dir)) {
    for (const name of Object.keys(PARSER_BY_FILENAME)) yield path.join(dir, name);
    if (!searchParents || path.dirname(dir) === dir) return;
  }
}

export { parseBunLock } from './bun.js';
export { parseNpmLock } from './npm.js';
export { parsePnpmLock } from './pnpm.js';
export { parseYarnLock } from './yarn.js';

/**
 * Parse a lockfile by passing the already read contents or the path to it.
 *
 * @param input The contents of the lockfile or the path to it.
 * @returns A `Promise` that resolves to a `Lockfile` object.
 */
export async function parseLockfile(input: string): Promise<Lockfile> {
  if (isContent(input)) return parseText(input);
  return parseText(await readFile(input, 'utf8'), input);
}

/**
 * Synchronous version of {@link parseLockfile}.
 *
 * @param input The contents of the lockfile or the path to it.
 * @returns The parsed `Lockfile`.
 */
export function parseLockfileSync(input: string): Lockfile {
  if (isContent(input)) return parseText(input);
  return parseText(readFileSync(input, 'utf8'), input);
}

/**
 * Finds a lockfile in `startDir`, and optionally in its parent directories.
 *
 * @param startDir The directory to start searching from. Defaults to cwd.
 * @param options.searchParents Also look in each parent directory, e.g. to find the root lockfile of a workspace. Defaults to `false`.
 * @returns The absolute path of the closest lockfile, or `undefined` if none is found.
 */
export async function findLockfile(
  startDir: string = process.cwd(),
  options: { searchParents?: boolean } = {},
): Promise<string | undefined> {
  for (const file of nextFile(startDir, options.searchParents ?? false)) {
    try {
      await access(file);
      return file;
    } catch {
      // nope, not in this directory.
    }
  }
  return undefined;
}

/**
 * Synchronous version of {@link findLockfile}.
 *
 * @param startDir The directory to start searching from. Defaults to cwd.
 * @param options.searchParents Also look in each parent directory, e.g. to find the root lockfile of a workspace. Defaults to `false`.
 * @returns The absolute path of the closest lockfile, or `undefined` if none is found.
 */
export function findLockfileSync(
  startDir: string = process.cwd(),
  options: { searchParents?: boolean } = {},
): string | undefined {
  for (const file of nextFile(startDir, options.searchParents ?? false)) {
    if (existsSync(file)) return file;
  }
  return undefined;
}

/**
 * Finds a lockfile with {@link findLockfile} and parses it with {@link parseLockfile}.
 *
 * @param startDir The directory to start searching from. Defaults to cwd.
 * @param options.searchParents Also look in each parent directory. Defaults to `false`.
 * @returns The parsed `Lockfile`, or `undefined` if no lockfile is found.
 */
export async function findAndParseLock(
  startDir?: string,
  options?: { searchParents?: boolean },
): Promise<Lockfile | undefined> {
  const file = await findLockfile(startDir, options);
  return file === undefined ? undefined : parseLockfile(file);
}

/**
 * Synchronous version of {@link findAndParseLock}.
 *
 * @param startDir The directory to start searching from. Defaults to cwd.
 * @param options.searchParents Also look in each parent directory. Defaults to `false`.
 * @returns The parsed `Lockfile`, or `undefined` if no lockfile is found.
 */
export function findAndParseLockSync(
  startDir?: string,
  options?: { searchParents?: boolean },
): Lockfile | undefined {
  const file = findLockfileSync(startDir, options);
  return file === undefined ? undefined : parseLockfileSync(file);
}
