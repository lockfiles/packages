import { describe, expect, it } from 'vitest';
import { parseBunLock } from '../src/bun.js';
import { parseNpmLock } from '../src/npm.js';
import { parsePnpmLock } from '../src/pnpm.js';
import { parseYarnLock } from '../src/yarn.js';

describe('npm lockfile', () => {
  it('resolves dependencies through nested node_modules', () => {
    const lock = parseNpmLock(
      JSON.stringify({
        lockfileVersion: 3,
        packages: {
          '': {},
          'node_modules/a': {
            version: '1.0.0',
            dependencies: { b: '^2', c: '^1' },
          },
          'node_modules/a/node_modules/b': { version: '2.0.0' },
          'node_modules/b': { version: '1.0.0' },
          'node_modules/c': { version: '1.5.0', integrity: 'sha512-x' },
        },
      }),
    );
    expect([...lock.get('a', '1.0.0')!.dependencies].sort()).toEqual(['b@2.0.0', 'c@1.5.0']);
    expect(lock.get('c', '1.5.0')!.integrity).toBe('sha512-x');
  });

  it('resolves the dependencies of workspace packages from the root node_modules', () => {
    const lock = parseNpmLock(
      JSON.stringify({
        lockfileVersion: 3,
        packages: {
          '': {},
          'node_modules/dayjs': { version: '1.11.0' },
          'node_modules/lib': { resolved: 'packages/lib', link: true },
          'packages/lib': {
            name: 'lib',
            version: '1.0.0',
            dependencies: { dayjs: '^1' },
          },
        },
      }),
    );
    expect([...lock.get('lib', '1.0.0')!.dependencies]).toEqual(['dayjs@1.11.0']);
  });

  it('rejects lockfileVersion 1', () => {
    expect(() => parseNpmLock('{"lockfileVersion":1,"dependencies":{}}')).toThrow(/not supported/);
  });
});

describe('pnpm lockfile', () => {
  it('reads v9 packages and snapshots, ignoring peer suffixes', () => {
    const lock = parsePnpmLock(`
lockfileVersion: '9.0'
packages:
  '@scope/a@1.0.0':
    resolution: {integrity: sha512-aaa}
  b@2.0.0:
    resolution: {integrity: sha512-bbb}
snapshots:
  '@scope/a@1.0.0(react@18.0.0)':
    dependencies:
      b: 2.0.0
      react: 18.0.0
  b@2.0.0: {}
`);
    const a = lock.get('@scope/a', '1.0.0')!;
    expect(a.integrity).toBe('sha512-aaa');
    expect([...a.dependencies].sort()).toEqual(['b@2.0.0', 'react@18.0.0']);
  });

  it('reads v6 keys with leading slash', () => {
    const lock = parsePnpmLock(`
lockfileVersion: '6.0'
packages:
  /a@1.0.0:
    resolution: {integrity: sha512-aaa}
    dependencies:
      b: 2.0.0_react@18.0.0
  /b@2.0.0_react@18.0.0:
    resolution: {integrity: sha512-bbb}
`);
    expect([...lock.get('a', '1.0.0')!.dependencies]).toEqual(['b@2.0.0']);
    expect(lock.get('b', '2.0.0')!.integrity).toBe('sha512-bbb');
  });
});

describe('yarn lockfile', () => {
  it('parses classic lockfiles', () => {
    const lock = parseYarnLock(`# yarn lockfile v1

a@^1.0.0, a@^1.1.0:
  version "1.2.0"
  resolved "https://registry.yarnpkg.com/a/-/a-1.2.0.tgz#abc"
  integrity sha512-aaa
  dependencies:
    b "^2.0.0"

b@^2.0.0:
  version "2.1.0"
`);
    const a = lock.get('a', '1.2.0')!;
    expect(a.integrity).toBe('sha512-aaa');
    expect([...a.dependencies]).toEqual(['b@2.1.0']);
  });

  it('parses berry lockfiles', () => {
    const lock = parseYarnLock(`__metadata:
  version: 8

"a@npm:^1.0.0":
  version: 1.2.0
  resolution: "a@npm:1.2.0"
  dependencies:
    b: ^2.0.0

"b@npm:^2.0.0":
  version: 2.1.0
  resolution: "b@npm:2.1.0"

"app@workspace:.":
  version: 0.0.0-use.local
  resolution: "app@workspace:."
`);
    expect([...lock.get('a', '1.2.0')!.dependencies]).toEqual(['b@2.1.0']);
    expect(lock.versionsOf('app')).toEqual([]);
  });
});

describe('bun lockfile', () => {
  it('reads JSONC with trailing commas, nested keys and aliases', () => {
    const lock = parseBunLock(`{
  "lockfileVersion": 2,
  "workspaces": { "": { "name": "app" } },
  "packages": {
    "a": ["a@1.0.0", "", { "dependencies": { "b": "^2", "@s/c": "^1", "d": "^1" } }, "sha512-aaa"],
    "a/b": ["b@2.0.0", "", {}, "sha512-bbb"],
    "b": ["b@1.0.0", "", {}, "sha512-b1"],
    "@s/c": ["@s/c@1.5.0", "", { "dependencies": { "b": "^1" } }, "sha512-ccc"],
    "d": ["d@npm:real-d@3.0.0", "", {}, "sha512-ddd"],
    "app-lib": ["app-lib@workspace:packages/lib"],
  },
}`);
    const a = lock.get('a', '1.0.0')!;
    expect(a.integrity).toBe('sha512-aaa');
    expect([...a.dependencies].sort()).toEqual(['@s/c@1.5.0', 'b@2.0.0', 'real-d@3.0.0']);
    expect([...lock.get('@s/c', '1.5.0')!.dependencies]).toEqual(['b@1.0.0']);
    expect(lock.versionsOf('app-lib')).toEqual([]);
  });

  it('reads workspaces, platform fields and infers dev/optional scopes', () => {
    const lock = parseBunLock(`{
  "lockfileVersion": 1,
  "workspaces": {
    "": { "name": "app", "dependencies": { "a": "^1" }, "devDependencies": { "t": "^1" } },
  },
  "packages": {
    "a": ["a@1.0.0", "", { "optionalDependencies": { "o": "^1" }, "bin": { "a": "cli.js" } }, "sha512-aaa"],
    "o": ["o@1.0.0", "", { "os": "darwin", "cpu": ["arm64"] }, "sha512-ooo"],
    "t": ["t@1.0.0", "", { "dependencies": { "u": "^1" } }, "sha512-ttt"],
    "u": ["u@1.0.0", "", {}, "sha512-uuu"],
  },
}`);
    expect(lock.lockfileVersion).toBe('1');
    const root = lock.importers.get('')!;
    expect(root.name).toBe('app');
    expect([...root.devDependencies]).toEqual(['t@1.0.0']);
    expect(lock.get('a', '1.0.0')).toMatchObject({
      dev: false,
      optional: false,
      bin: { a: 'cli.js' },
      source: 'registry',
      ranges: { o: '^1' },
    });
    expect([...lock.get('a', '1.0.0')!.optionalDependencies]).toEqual(['o@1.0.0']);
    expect(lock.get('o', '1.0.0')).toMatchObject({
      optional: true,
      dev: false,
      os: ['darwin'],
      cpu: ['arm64'],
    });
    expect(lock.get('u', '1.0.0')).toMatchObject({ dev: true, optional: false });
  });
});

describe('npm lockfile metadata', () => {
  it('reads flags, metadata, sources and importers', () => {
    const lock = parseNpmLock(
      JSON.stringify({
        lockfileVersion: 3,
        packages: {
          '': {
            name: 'app',
            version: '1.0.0',
            dependencies: { a: '^1' },
            devDependencies: { d: '^1' },
          },
          'node_modules/a': {
            version: '1.0.0',
            resolved: 'https://registry.npmjs.org/a/-/a-1.0.0.tgz',
            license: 'MIT',
            bin: { a: 'cli.js' },
            engines: { node: '>=18' },
            hasInstallScript: true,
            peerDependencies: { p: '*' },
            optionalDependencies: { o: '^1' },
          },
          'node_modules/d': { version: '1.0.0', dev: true, deprecated: 'use e' },
          'node_modules/o': { version: '1.0.0', optional: true, os: ['linux'], cpu: ['x64'] },
          'node_modules/p': { version: '1.0.0', peer: true },
          'node_modules/g': { version: '1.0.0', resolved: 'git+ssh://git@github.com/x/g.git#abc' },
        },
      }),
    );
    expect(lock.lockfileVersion).toBe('3');
    expect(lock.importers.get('')).toMatchObject({ name: 'app', version: '1.0.0' });
    expect([...lock.importers.get('')!.devDependencies]).toEqual(['d@1.0.0']);
    expect(lock.get('a', '1.0.0')).toMatchObject({
      source: 'registry',
      license: 'MIT',
      bin: { a: 'cli.js' },
      engines: { node: '>=18' },
      hasInstallScript: true,
      dev: false,
    });
    expect([...lock.get('a', '1.0.0')!.peerDependencies]).toEqual(['p@1.0.0']);
    expect([...lock.get('a', '1.0.0')!.optionalDependencies]).toEqual(['o@1.0.0']);
    expect(lock.get('d', '1.0.0')).toMatchObject({ dev: true, deprecated: 'use e' });
    expect(lock.get('o', '1.0.0')).toMatchObject({ optional: true, os: ['linux'], cpu: ['x64'] });
    expect(lock.get('p', '1.0.0')!.peer).toBe(true);
    expect(lock.get('g', '1.0.0')!.source).toBe('git');
  });
});

describe('pnpm lockfile metadata', () => {
  it('reads importers, metadata and infers dev scope', () => {
    const lock = parsePnpmLock(`
lockfileVersion: '9.0'
importers:
  .:
    dependencies:
      a:
        specifier: ^1
        version: 1.0.0
    devDependencies:
      d:
        specifier: ^1
        version: 1.0.0
packages:
  a@1.0.0:
    resolution: {integrity: sha512-aaa}
    engines: {node: '>=18'}
    cpu: [x64]
    deprecated: old
    peerDependencies: {p: '*'}
  d@1.0.0:
    resolution: {integrity: sha512-ddd}
  p@1.0.0:
    resolution: {integrity: sha512-ppp}
  g@https://codeload.github.com/x/g/tar.gz/abc:
    resolution: {tarball: 'https://codeload.github.com/x/g/tar.gz/abc'}
    version: 2.0.0
snapshots:
  a@1.0.0:
    dependencies:
      p: 1.0.0
      g: https://codeload.github.com/x/g/tar.gz/abc
  d@1.0.0: {}
  p@1.0.0:
    optional: true
  g@https://codeload.github.com/x/g/tar.gz/abc: {}
`);
    expect([...lock.importers.get('')!.dependencies]).toEqual(['a@1.0.0']);
    expect([...lock.importers.get('')!.devDependencies]).toEqual(['d@1.0.0']);
    expect(lock.get('a', '1.0.0')).toMatchObject({
      dev: false,
      engines: { node: '>=18' },
      cpu: ['x64'],
      deprecated: 'old',
      source: 'registry',
    });
    expect([...lock.get('a', '1.0.0')!.peerDependencies]).toEqual(['p@1.0.0']);
    expect([...lock.get('a', '1.0.0')!.dependencies].sort()).toEqual(['g@2.0.0', 'p@1.0.0']);
    expect(lock.get('d', '1.0.0')!.dev).toBe(true);
    expect(lock.get('p', '1.0.0')!.optional).toBe(true);
    expect(lock.get('g', '2.0.0')).toMatchObject({
      source: 'git',
      resolved: 'https://codeload.github.com/x/g/tar.gz/abc',
    });
  });
});

describe('yarn lockfile metadata', () => {
  it('reads classic optional dependencies and sources', () => {
    const lock = parseYarnLock(`# yarn lockfile v1

a@^1.0.0:
  version "1.0.0"
  resolved "https://registry.yarnpkg.com/a/-/a-1.0.0.tgz#abc"
  optionalDependencies:
    o "^1.0.0"

o@^1.0.0:
  version "1.0.0"
  resolved "git+ssh://git@github.com/x/o.git#abc"
`);
    expect(lock.lockfileVersion).toBe('1');
    expect(lock.get('a', '1.0.0')).toMatchObject({
      source: 'registry',
      ranges: { o: '^1.0.0' },
    });
    expect([...lock.get('a', '1.0.0')!.optionalDependencies]).toEqual(['o@1.0.0']);
    expect(lock.get('o', '1.0.0')!.source).toBe('git');
  });

  it('reads berry checksums, platform conditions, optional deps and workspaces', () => {
    const lock = parseYarnLock(`__metadata:
  version: 8

"a@npm:^1.0.0":
  version: 1.0.0
  resolution: "a@npm:1.0.0"
  dependencies:
    o: ^1.0.0
  dependenciesMeta:
    o:
      optional: true
  bin:
    a: cli.js
  checksum: 10c0/abc
  languageName: node
  linkType: hard

"o@npm:^1.0.0":
  version: 1.0.0
  resolution: "o@npm:1.0.0"
  checksum: 10c0/def
  conditions: os=darwin & cpu=arm64
  languageName: node
  linkType: hard

"app@workspace:.":
  version: 0.0.0-use.local
  resolution: "app@workspace:."
  dependencies:
    a: ^1.0.0
  languageName: unknown
  linkType: soft
`);
    expect(lock.lockfileVersion).toBe('8');
    expect(lock.get('a', '1.0.0')).toMatchObject({
      checksum: '10c0/abc',
      bin: { a: 'cli.js' },
      source: 'registry',
    });
    expect([...lock.get('a', '1.0.0')!.optionalDependencies]).toEqual(['o@1.0.0']);
    expect(lock.get('o', '1.0.0')).toMatchObject({ os: ['darwin'], cpu: ['arm64'] });
    expect(lock.importers.get('')).toMatchObject({ name: 'app' });
    expect(lock.importers.get('')!.version).toBeUndefined();
    expect([...lock.importers.get('')!.dependencies]).toEqual(['a@1.0.0']);
  });
});
