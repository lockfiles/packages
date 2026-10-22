import type { Manifest } from './manifest.js';
import type { RegistryOptions } from './types.js';

export const DEFAULT_REGISTRY = 'https://registry.npmjs.org';

export interface ResolvedRegistryOptions {
  url: string;
  concurrency: number;
  timeout: number;
  fetch: typeof fetch;
  signal?: AbortSignal;
}

export function resolveRegistryOptions(
  options: boolean | RegistryOptions,
): ResolvedRegistryOptions {
  const custom = typeof options === 'object' ? options : {};
  return {
    url: (custom.url ?? DEFAULT_REGISTRY).replace(/\/+$/, ''),
    concurrency: custom.concurrency ?? 16,
    timeout: custom.timeout ?? 30_000,
    fetch: custom.fetch ?? fetch,
    signal: custom.signal,
  };
}

/** Gets the manifest of one version of a package. Returns `undefined` if the registry doesn't know it. */
export async function fetchManifest(
  name: string,
  version: string,
  options: ResolvedRegistryOptions,
): Promise<Manifest | undefined> {
  const url = `${options.url}/${name.replace('/', '%2F')}/${encodeURIComponent(version)}`;
  const signal = options.signal
    ? AbortSignal.any([options.signal, AbortSignal.timeout(options.timeout)])
    : AbortSignal.timeout(options.timeout);

  const response = await options.fetch(url, { headers: { accept: 'application/json' }, signal });
  if (response.status === 404) return undefined;
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`.trim());
  return (await response.json()) as Manifest;
}
