import { Lockfile } from '@lockfiles/parse';
import { describe, expect, it } from 'vitest';
import { enrich } from '../src/index.js';
import { loadFixture, mockRegistry } from './helpers.js';

const offline = { project: false, nodeModules: false };

describe('metadata from the registry', () => {
  it('should fill integrity, resolved and metadata for yarn berry', async () => {
    const registry = mockRegistry();
    const lockfile = await loadFixture('yarn-berry/yarn.lock');
    expect(lockfile.get('react', '18.3.1')!.integrity).toBeUndefined();

    const report = await enrich(lockfile, { ...offline, registry: { fetch: registry.fetch } });

    expect(lockfile.get('react', '18.3.1')).toMatchObject({
      integrity:
        'sha512-wS+hAgJShR0KhEvPJArfuPVN1+Hz1t0Y6n5jLrGQbkb4urgPE/0Rve+1kMB1v/oWgHgm4WIcV+i7F2pTVj+2iQ==',
      resolved: 'https://registry.npmjs.org/react/-/react-18.3.1.tgz',
      license: 'MIT',
      engines: { node: '>=0.10.0' },
    });
    expect(lockfile.get('esbuild', '0.24.0')).toMatchObject({
      license: 'MIT',
      hasInstallScript: true,
    });
    expect(report.sources.get('react@18.3.1')).toMatchObject({
      integrity: 'registry',
      resolved: 'registry',
      license: 'registry',
    });
  });

  it('should fill what yarn classic and bun do not store', async () => {
    const registry = mockRegistry();
    const classic = await loadFixture('yarn-v1/yarn.lock');
    const bun = await loadFixture('bun/bun.lock');

    await enrich(classic, { ...offline, registry: { fetch: registry.fetch } });
    await enrich(bun, { ...offline, registry: { fetch: registry.fetch } });

    expect(classic.get('typescript', '5.6.3')).toMatchObject({
      license: 'Apache-2.0',
      bin: { tsc: 'bin/tsc', tsserver: 'bin/tsserver' },
      engines: { node: '>=14.17' },
    });
    expect(classic.get('@esbuild/darwin-arm64', '0.24.0')).toMatchObject({
      os: ['darwin'],
      cpu: ['arm64'],
    });
    expect(bun.get('react', '18.3.1')).toMatchObject({
      resolved: 'https://registry.npmjs.org/react/-/react-18.3.1.tgz',
      license: 'MIT',
    });
  });

  it('should fill the download link for pnpm, which does not store it', async () => {
    const registry = mockRegistry();
    const lockfile = await loadFixture('pnpm/pnpm-lock.yaml');
    expect(lockfile.get('react', '18.3.1')!.resolved).toBeUndefined();

    await enrich(lockfile, { ...offline, registry: { fetch: registry.fetch } });

    expect(lockfile.get('react', '18.3.1')).toMatchObject({
      resolved: 'https://registry.npmjs.org/react/-/react-18.3.1.tgz',
      license: 'MIT',
    });
  });

  it('should report packages that the registry does not know', async () => {
    const registry = mockRegistry();
    const lockfile = await loadFixture('yarn-v1/yarn.lock');

    const report = await enrich(lockfile, { ...offline, registry: { fetch: registry.fetch } });

    expect(report.failed).toContainEqual({ key: 'scheduler@0.23.2', error: 'not found' });
    expect(report.failed.some((failure) => failure.key === 'react@18.3.1')).toBe(false);
  });

  it('should encode the name of scoped packages and use the registry url', async () => {
    const registry = mockRegistry();
    const lockfile = await loadFixture('yarn-v1/yarn.lock');

    await enrich(lockfile, {
      ...offline,
      registry: { fetch: registry.fetch, url: 'https://registry.example.com/npm/' },
    });

    expect(registry.requests).toContain(
      'https://registry.example.com/npm/@esbuild%2Fdarwin-arm64/0.24.0',
    );
    expect(
      registry.requests.every((url) => url.startsWith('https://registry.example.com/npm/')),
    ).toBe(true);
  });

  it('should not ask the registry by default', async () => {
    const registry = mockRegistry();
    const original = globalThis.fetch;
    globalThis.fetch = registry.fetch;
    try {
      await enrich(await loadFixture('yarn-v1/yarn.lock'), offline);
    } finally {
      globalThis.fetch = original;
    }

    expect(registry.requests).toEqual([]);
  });

  it('should use the global fetch with registry: true', async () => {
    const registry = mockRegistry();
    const original = globalThis.fetch;
    globalThis.fetch = registry.fetch;
    try {
      await enrich(await loadFixture('yarn-v1/yarn.lock'), { ...offline, registry: true });
    } finally {
      globalThis.fetch = original;
    }

    expect(registry.requests.length).toBeGreaterThan(0);
    expect(registry.requests[0]).toMatch(/^https:\/\/registry\.npmjs\.org\//);
  });

  it('should not ask for npm lockfiles, which store everything', async () => {
    const registry = mockRegistry();

    const report = await enrich(await loadFixture('npm/package-lock.json'), {
      ...offline,
      registry: { fetch: registry.fetch },
    });

    expect(registry.requests).toEqual([]);
    expect(report.filled).toEqual({});
  });

  it('should only ask for packages from the registry', async () => {
    const registry = mockRegistry();
    const lockfile = new Lockfile('bun');
    lockfile.add('react', '18.3.1', { source: 'registry' });
    lockfile.add('from-git', '1.0.0', { source: 'git' });
    lockfile.add('local', '1.0.0', { source: 'workspace' });

    await enrich(lockfile, { ...offline, registry: { fetch: registry.fetch } });

    expect(registry.requests).toHaveLength(1);
    expect(registry.requests[0]).toContain('/react/18.3.1');
  });

  it('should not replace values that the lockfile has', async () => {
    const registry = mockRegistry();
    const lockfile = new Lockfile('yarn');
    lockfile.lockfileVersion = '10';
    lockfile.add('react', '18.3.1', {
      source: 'registry',
      integrity: 'sha512-mine',
      license: 'ISC',
    });

    await enrich(lockfile, { ...offline, registry: { fetch: registry.fetch } });

    expect(lockfile.get('react', '18.3.1')).toMatchObject({
      integrity: 'sha512-mine',
      license: 'ISC',
    });
  });

  it('should limit the requests that run at the same time', async () => {
    const registry = mockRegistry({ delay: 5 });
    const lockfile = await loadFixture('yarn-v1/yarn.lock');

    await enrich(lockfile, { ...offline, registry: { fetch: registry.fetch, concurrency: 2 } });

    expect(registry.requests.length).toBeGreaterThan(4);
    expect(registry.maxRunning()).toBe(2);
  });

  it('should report failed requests and go on', async () => {
    const registry = mockRegistry();
    const failing = (async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input).includes('/react/'))
        return new Response('', { status: 500, statusText: 'Server Error' });
      if (String(input).includes('/esbuild/')) throw new Error('network down');
      return registry.fetch(input, init);
    }) as typeof fetch;
    const lockfile = await loadFixture('yarn-v1/yarn.lock');

    const report = await enrich(lockfile, { ...offline, registry: { fetch: failing } });

    expect(report.failed).toContainEqual({ key: 'react@18.3.1', error: '500 Server Error' });
    expect(report.failed).toContainEqual({ key: 'esbuild@0.24.0', error: 'network down' });
    expect(lockfile.get('typescript', '5.6.3')!.license).toBe('Apache-2.0');
  });

  it('should say why a request failed', async () => {
    const refused = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:9'), {
      code: 'ECONNREFUSED',
    });
    const withCause = (async () => {
      throw new TypeError('fetch failed', { cause: refused });
    }) as typeof fetch;
    const withCode = (async () => {
      throw new TypeError('fetch failed', {
        cause: Object.assign(new AggregateError([]), { code: 'ECONNREFUSED' }),
      });
    }) as typeof fetch;
    const lockfile = new Lockfile('bun');
    lockfile.add('react', '18.3.1', { source: 'registry' });

    const first = await enrich(lockfile, { ...offline, registry: { fetch: withCause } });
    const second = await enrich(lockfile, { ...offline, registry: { fetch: withCode } });

    expect(first.failed).toEqual([
      { key: 'react@18.3.1', error: 'fetch failed: connect ECONNREFUSED 127.0.0.1:9' },
    ]);
    expect(second.failed).toEqual([{ key: 'react@18.3.1', error: 'fetch failed: ECONNREFUSED' }]);
  });

  it('should stop when the signal is aborted', async () => {
    const registry = mockRegistry();
    const lockfile = await loadFixture('yarn-v1/yarn.lock');

    const report = await enrich(lockfile, {
      ...offline,
      registry: { fetch: registry.fetch, signal: AbortSignal.abort() },
    });

    expect(registry.requests).toEqual([]);
    expect(report.failed.length).toBeGreaterThan(0);
  });
});
