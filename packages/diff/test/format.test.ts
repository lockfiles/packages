import { Lockfile } from '@lockfiles/parse';
import { describe, expect, it } from 'vitest';
import { diffLockfiles, formatDiff } from '../src/index.js';

const build = (...packages: [name: string, version: string, extra?: object][]) => {
  const lockfile = new Lockfile('npm');
  for (const [name, version, extra] of packages) lockfile.add(name, version, extra);
  return lockfile;
};

const before = build(
  ['removed', '1.0.0'],
  ['react', '18.2.0'],
  ['multi', '1.0.0'],
  ['multi', '2.0.0'],
  ['same', '1.0.0', { integrity: 'sha512-old' }],
);
const after = build(
  ['added', '3.1.0'],
  ['react', '18.3.1'],
  ['multi', '3.0.0'],
  ['same', '1.0.0', { integrity: 'sha512-new' }],
);

describe('formatDiff', () => {
  it('should write plain text by default', () => {
    expect(formatDiff(diffLockfiles(before, after))).toBe(
      [
        '1 added, 1 removed, 2 updated, 1 with changed integrity',
        '',
        '+ added@3.1.0',
        '- removed@1.0.0',
        '~ multi 1.0.0, 2.0.0 -> 3.0.0',
        '~ react 18.2.0 -> 18.3.1 (minor upgrade)',
        '! same@1.0.0 has a different integrity hash',
      ].join('\n'),
    );
  });

  it('should write Markdown', () => {
    expect(formatDiff(diffLockfiles(before, after), { format: 'markdown' })).toBe(
      [
        '## Dependency changes',
        '',
        '1 added, 1 removed, 2 updated, 1 with changed integrity',
        '',
        '### Integrity changed',
        '',
        '> [!WARNING]',
        '> The same version has a different integrity hash in the new lockfile.',
        '',
        '- `same@1.0.0`',
        '',
        '### Updated',
        '',
        '| Package | Before | After | Change |',
        '| --- | --- | --- | --- |',
        '| `multi` | 1.0.0, 2.0.0 | 3.0.0 |  |',
        '| `react` | 18.2.0 | 18.3.1 | minor upgrade |',
        '',
        '### Added',
        '',
        '- `added@3.1.0`',
        '',
        '### Removed',
        '',
        '- `removed@1.0.0`',
      ].join('\n'),
    );
  });

  it('should leave out empty sections in Markdown', () => {
    const diff = diffLockfiles(build(['a', '1.0.0']), build(['a', '1.0.0'], ['b', '1.0.0']));
    const markdown = formatDiff(diff, { format: 'markdown' });

    expect(markdown).toContain('### Added');
    expect(markdown).not.toContain('### Removed');
    expect(markdown).not.toContain('### Updated');
    expect(markdown).not.toContain('Integrity');
  });

  it('should say so when nothing changed', () => {
    const diff = diffLockfiles(before, before);

    expect(formatDiff(diff)).toBe('No changes.');
    expect(formatDiff(diff, { format: 'markdown' })).toBe('## Dependency changes\n\nNo changes.');
  });
});
