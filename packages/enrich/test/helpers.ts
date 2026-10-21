import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { type LockEntry, parseLockfile } from '@lockfiles/parse';

export const fixturesDir = join(import.meta.dirname, 'fixtures');
export const loadFixture = (file: string) => parseLockfile(join(fixturesDir, file));
export const names = (entries: Iterable<LockEntry>) => [...entries].map((e) => e.name).sort();

export const PRODUCTION = ['js-tokens', 'loose-envify', 'react', 'react-dom', 'scheduler'];

/** Creates a temporary folder with the given files, and a function that removes it. */
export async function createProject(
  files: Record<string, unknown>,
): Promise<{ dir: string; remove: () => Promise<void> }> {
  const dir = await mkdtemp(join(tmpdir(), 'lockfiles-enrich-'));
  for (const [file, content] of Object.entries(files)) {
    await mkdir(dirname(join(dir, file)), { recursive: true });
    await writeFile(
      join(dir, file),
      typeof content === 'string' ? content : JSON.stringify(content),
    );
  }
  return { dir, remove: () => rm(dir, { recursive: true, force: true }) };
}

/**
 * A `fetch` that answers with the manifests in `fixtures/registry`.
 * Packages without a fixture get a 404.
 */
export function mockRegistry(options: { delay?: number } = {}) {
  const requests: string[] = [];
  let running = 0;
  let maxRunning = 0;

  const mock = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    init?.signal?.throwIfAborted();
    const url = String(input);
    requests.push(url);
    running++;
    maxRunning = Math.max(maxRunning, running);
    try {
      if (options.delay) await new Promise((resolve) => setTimeout(resolve, options.delay));
      const [name, version] = new URL(url).pathname
        .slice(1)
        .split('/')
        .map((part) => decodeURIComponent(part));
      const file = join(fixturesDir, 'registry', `${name}@${version}`.replace('/', '+') + '.json');
      try {
        return new Response(await readFile(file, 'utf8'), { status: 200 });
      } catch {
        return new Response('{}', { status: 404, statusText: 'Not Found' });
      }
    } finally {
      running--;
    }
  };

  return { fetch: mock as typeof fetch, requests, maxRunning: () => maxRunning };
}
