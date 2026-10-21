import { describe, expect, it } from 'vitest';
import { applyManifest, binOf, hasInstallScriptIn, licenseOf } from '../src/manifest.js';
import { Tracker } from '../src/tracker.js';
import { Lockfile } from '@lockfiles/parse';
import type { EnrichedField } from '../src/types.js';

describe('licenseOf', () => {
  it('should read a license text', () => {
    expect(licenseOf({ license: 'MIT' })).toBe('MIT');
    expect(licenseOf({ license: ' Apache-2.0 ' })).toBe('Apache-2.0');
    expect(licenseOf({ license: 'SEE LICENSE IN LICENSE.md' })).toBe('SEE LICENSE IN LICENSE.md');
  });

  it('should read the old object form', () => {
    expect(licenseOf({ license: { type: 'ISC', url: 'https://example.com' } })).toBe('ISC');
  });

  it('should read the old licenses list', () => {
    expect(licenseOf({ licenses: [{ type: 'MIT' }] })).toBe('MIT');
    expect(licenseOf({ licenses: [{ type: 'MIT' }, { type: 'Apache-2.0' }] })).toBe(
      '(MIT OR Apache-2.0)',
    );
  });

  it('should return undefined if there is no usable license', () => {
    expect(licenseOf({})).toBeUndefined();
    expect(licenseOf({ license: '' })).toBeUndefined();
    expect(licenseOf({ license: 42 })).toBeUndefined();
    expect(licenseOf({ licenses: [] })).toBeUndefined();
  });
});

describe('binOf', () => {
  it('should name a single path after the package', () => {
    expect(binOf({ bin: 'cli.js' }, 'tool')).toEqual({ tool: 'cli.js' });
    expect(binOf({ bin: 'cli.js' }, '@scope/tool')).toEqual({ tool: 'cli.js' });
  });

  it('should keep a map of commands', () => {
    expect(binOf({ bin: { a: 'a.js', b: 'b.js' } }, 'tool')).toEqual({ a: 'a.js', b: 'b.js' });
  });

  it('should ignore other values', () => {
    expect(binOf({}, 'tool')).toBeUndefined();
    expect(binOf({ bin: {} }, 'tool')).toBeUndefined();
    expect(binOf({ bin: 42 }, 'tool')).toBeUndefined();
  });
});

describe('hasInstallScriptIn', () => {
  it('should find install scripts', () => {
    expect(hasInstallScriptIn({ scripts: { postinstall: 'node x.js' } }, false)).toBe(true);
    expect(hasInstallScriptIn({ scripts: { preinstall: 'x' } }, false)).toBe(true);
    expect(hasInstallScriptIn({ scripts: { install: 'node-gyp rebuild' } }, false)).toBe(true);
  });

  it('should ignore other scripts', () => {
    expect(hasInstallScriptIn({ scripts: { test: 'vitest', build: 'tsc' } }, false)).toBe(false);
    expect(hasInstallScriptIn({ scripts: { install: '' } }, false)).toBe(false);
    expect(hasInstallScriptIn({}, false)).toBe(false);
  });

  it('should find native builds', () => {
    expect(hasInstallScriptIn({}, true)).toBe(true);
    expect(hasInstallScriptIn({ gypfile: true }, false)).toBe(true);
    expect(hasInstallScriptIn({ hasInstallScript: true }, false)).toBe(true);
  });
});

describe('applyManifest', () => {
  const manifest = {
    license: 'MIT',
    engines: { node: '>=18' },
    bin: { a: 'a.js' },
    os: 'darwin',
    cpu: ['arm64'],
    libc: ['glibc'],
    deprecated: 'use b',
    scripts: { postinstall: 'x' },
    dist: { integrity: 'sha512-abc', tarball: 'https://example.com/a.tgz' },
  };
  const everything = new Set<EnrichedField>([
    'license',
    'engines',
    'bin',
    'os',
    'cpu',
    'libc',
    'hasInstallScript',
    'deprecated',
    'integrity',
    'resolved',
  ]);

  it('should fill every wanted field', () => {
    const entry = new Lockfile('yarn').add('a', '1.0.0');

    applyManifest(new Tracker(), entry, manifest, everything, 'registry');

    expect(entry).toMatchObject({
      license: 'MIT',
      engines: { node: '>=18' },
      bin: { a: 'a.js' },
      os: ['darwin'],
      cpu: ['arm64'],
      libc: ['glibc'],
      deprecated: 'use b',
      hasInstallScript: true,
      integrity: 'sha512-abc',
      resolved: 'https://example.com/a.tgz',
    });
  });

  it('should leave out fields that are not wanted', () => {
    const entry = new Lockfile('yarn').add('a', '1.0.0');

    applyManifest(new Tracker(), entry, manifest, new Set<EnrichedField>(['license']), 'registry');

    expect(entry.license).toBe('MIT');
    expect(entry.engines).toBeUndefined();
    expect(entry.integrity).toBeUndefined();
  });

  it('should ignore values of the wrong type', () => {
    const entry = new Lockfile('yarn').add('a', '1.0.0');

    applyManifest(
      new Tracker(),
      entry,
      { engines: ['node'], os: [1], deprecated: '', dist: 'nope' },
      everything,
      'registry',
    );

    expect(entry.engines).toBeUndefined();
    expect(entry.os).toBeUndefined();
    expect(entry.deprecated).toBeUndefined();
    expect(entry.integrity).toBeUndefined();
  });
});
