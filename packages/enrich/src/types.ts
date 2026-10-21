export type EnrichSource = 'project' | 'node_modules' | 'registry';

export type EnrichedField =
  | 'dev'
  | 'optional'
  | 'license'
  | 'engines'
  | 'bin'
  | 'os'
  | 'cpu'
  | 'libc'
  | 'hasInstallScript'
  | 'deprecated'
  | 'integrity'
  | 'resolved';

export interface RegistryOptions {
  /** Defaults to `https://registry.npmjs.org`. */
  url?: string;
  /** How many requests run at the same time. Defaults to `16`. */
  concurrency?: number;
  /** Time limit for one request in milliseconds. Defaults to `30000`. */
  timeout?: number;
  /** Use this to add headers like authentication or to mock the network. Defaults to the global `fetch`. */
  fetch?: typeof fetch;
  /** Stops all requests. */
  signal?: AbortSignal;
}

export interface EnrichOptions {
  /** The folder with the `package.json` and `node_modules` of the project. Defaults to cwd. */
  projectDir?: string;
  /** Read the `package.json`. Defaults to `true`. */
  project?: boolean;
  /** Read the metadata of installed packages from `node_modules`. Defaults to `true`. */
  nodeModules?: boolean;
  /** Whether to query the registry for missing information. */
  registry?: boolean | RegistryOptions;
}

export interface EnrichReport {
  /** How many values were filled, for each field. */
  filled: Partial<Record<EnrichedField, number>>;
  /** Where each filled value came from, keyed by `name@version`. */
  sources: Map<string, Partial<Record<EnrichedField, EnrichSource>>>;
  /** Dependencies in a `package.json` that could not be found in the lockfile, like `packages/app: react@^18.0.0`. */
  unresolved: string[];
  /** Packages that the registry could not give data for. */
  failed: { key: string; error: string }[];
}
