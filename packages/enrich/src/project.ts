import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { inferScopes, keyOf, type Lockfile } from '@lockfiles/parse';
import { glob } from 'tinyglobby';
import { parse as parseYaml } from 'yaml';
import type { Tracker } from './tracker.js';

type Deps = Record<string, string>;

interface PackageJson {
  name?: string;
  version?: string;
  dependencies?: Deps;
  devDependencies?: Deps;
  optionalDependencies?: Deps;
  workspaces?: string[] | { packages?: string[] };
}

interface Workspace {
  /** Path relative to the project, empty for the root. */
  path: string;
  json: PackageJson;
}

async function readJson(file: string): Promise<PackageJson | undefined> {
  try {
    return JSON.parse(await readFile(file, 'utf8')) as PackageJson;
  } catch {
    return undefined;
  }
}

async function workspacePatterns(projectDir: string, root: PackageJson): Promise<string[]> {
  const fromPackageJson = Array.isArray(root.workspaces)
    ? root.workspaces
    : root.workspaces?.packages;
  if (fromPackageJson) return fromPackageJson;
  try {
    const yaml = parseYaml(
      await readFile(path.join(projectDir, 'pnpm-workspace.yaml'), 'utf8'),
    ) as {
      packages?: string[];
    } | null;
    return yaml?.packages ?? [];
  } catch {
    return [];
  }
}

async function readWorkspaces(projectDir: string, root: PackageJson): Promise<Workspace[]> {
  const include: string[] = [];
  const ignore = ['**/node_modules/**'];
  for (const pattern of await workspacePatterns(projectDir, root)) {
    const clean = pattern.replace(/^\.\//, '').replace(/\/$/, '');
    if (clean.startsWith('!')) ignore.push(`${clean.slice(1)}/**`);
    else include.push(`${clean}/package.json`);
  }
  if (include.length === 0) return [];

  const files = (await glob(include, { cwd: projectDir, ignore })).sort();
  const workspaces: Workspace[] = [];
  for (const file of files) {
    const json = await readJson(path.join(projectDir, file));
    if (json) workspaces.push({ path: path.posix.dirname(file), json });
  }
  return workspaces;
}

/**
 * Finds out which packages are dev or optional for lockfiles that do not store it (yarn).
 * It reads the `package.json` of the project and its workspaces to see which dependencies are dev or optional,
 * and then follows the dependencies in the lockfile from there.
 */
export async function applyProject(
  lockfile: Lockfile,
  projectDir: string,
  tracker: Tracker,
): Promise<void> {
  const root = await readJson(path.join(projectDir, 'package.json'));
  if (!root) return;

  const packages: Workspace[] = [
    { path: '', json: root },
    ...(await readWorkspaces(projectDir, root)),
  ];
  const workspaceNames = new Set(packages.map((p) => p.json.name).filter(Boolean));

  const resolveAll = (deps: Deps | undefined, where: string): Set<string> => {
    const keys = new Set<string>();
    for (const [name, spec] of Object.entries(deps ?? {})) {
      // Dependencies on other workspaces are not installed from the registry.
      if (workspaceNames.has(name)) continue;
      const alias = /^npm:(@?[^@]+)@(.+)$/.exec(spec);
      const entry = alias ? lockfile.resolve(alias[1]!, alias[2]!) : lockfile.resolve(name, spec);
      if (entry) keys.add(keyOf(entry.name, entry.version));
      else if (!/^(?:workspace|link|portal):/.test(spec)) {
        tracker.report.unresolved.push(`${where || '.'}: ${name}@${spec}`);
      }
    }
    return keys;
  };

  for (const { path: workspacePath, json } of packages) {
    const importer = lockfile.importer(workspacePath);
    importer.name = json.name;
    importer.version = json.version;
    importer.dependencies = resolveAll(json.dependencies, workspacePath);
    importer.devDependencies = resolveAll(json.devDependencies, workspacePath);
    importer.optionalDependencies = resolveAll(json.optionalDependencies, workspacePath);
  }

  const before = new Map(lockfile.entries);
  const missing = [...before.values()].filter(
    (entry) => entry.dev === undefined || entry.optional === undefined,
  );
  const hadDev = new Set(missing.filter((entry) => entry.dev === undefined));
  const hadOptional = new Set(missing.filter((entry) => entry.optional === undefined));
  inferScopes(lockfile);
  for (const entry of hadDev) if (entry.dev !== undefined) tracker.record(entry, 'dev', 'project');
  for (const entry of hadOptional) {
    if (entry.optional !== undefined) tracker.record(entry, 'optional', 'project');
  }
}
