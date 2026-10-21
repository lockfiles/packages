import { access, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { keyOf, type LockEntry } from '@lockfiles/parse';
import type { Manifest } from './manifest.js';
import { pool } from './util.js';

export interface InstalledPackage {
  manifest: Manifest;
  hasBindingGyp: boolean;
}

const exists = async (file: string): Promise<boolean> =>
  access(file).then(
    () => true,
    () => false,
  );

/** The pnpm store has a folder for each package, named like `@scope+name@1.0.0_peer@2.0.0`. */
async function readPnpmStore(nodeModules: string): Promise<Map<string, string[]>> {
  const index = new Map<string, string[]>();
  let folders: string[];
  try {
    folders = await readdir(path.join(nodeModules, '.pnpm'));
  } catch {
    return index;
  }
  for (const folder of folders) {
    const at = folder.indexOf('@', 1);
    if (at < 0) continue;
    const name = folder.slice(0, at).replace('+', '/');
    const version = folder.slice(at + 1).split(/[_(]/)[0]!;
    const key = keyOf(name, version);
    index.set(key, [...(index.get(key) ?? []), folder]);
  }
  return index;
}

async function readInstalledPackage(
  directory: string,
  entry: LockEntry,
): Promise<InstalledPackage | undefined> {
  try {
    const manifest = JSON.parse(
      await readFile(path.join(directory, 'package.json'), 'utf8'),
    ) as Manifest & { version?: string };
    if (manifest.version !== entry.version) return undefined;
    return { manifest, hasBindingGyp: await exists(path.join(directory, 'binding.gyp')) };
  } catch {
    return undefined;
  }
}

/**
 * Reads the `package.json` of installed packages. It finds packages in `node_modules` and in the pnpm store,
 * and only uses a package if its version is the one from the lockfile.
 */
export async function readInstalled(
  projectDir: string,
  entries: readonly LockEntry[],
  concurrency: number,
): Promise<Map<LockEntry, InstalledPackage>> {
  const found = new Map<LockEntry, InstalledPackage>();
  const nodeModules = path.join(projectDir, 'node_modules');
  if (entries.length === 0 || !(await exists(nodeModules))) return found;
  const pnpmStore = await readPnpmStore(nodeModules);

  await pool(entries, concurrency, async (entry) => {
    const directories = [
      path.join(nodeModules, entry.name),
      ...(pnpmStore.get(keyOf(entry.name, entry.version)) ?? []).map((folder) =>
        path.join(nodeModules, '.pnpm', folder, 'node_modules', entry.name),
      ),
    ];
    for (const directory of directories) {
      const installed = await readInstalledPackage(directory, entry);
      if (installed) {
        found.set(entry, installed);
        return;
      }
    }
  });
  return found;
}
