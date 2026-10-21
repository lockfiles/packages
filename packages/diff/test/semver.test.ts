import { describe, expect, it } from 'vitest';
import { bumpOf, compareVersions, sortVersions } from '../src/semver.js';

describe('compareVersions', () => {
  it('should compare the numbers of a version', () => {
    expect(compareVersions('1.0.0', '2.0.0')).toBe(-1);
    expect(compareVersions('1.2.0', '1.10.0')).toBe(-1);
    expect(compareVersions('1.0.10', '1.0.9')).toBe(1);
    expect(compareVersions('1.2.3', '1.2.3')).toBe(0);
  });

  it('should ignore a leading v and build metadata', () => {
    expect(compareVersions('v1.0.0', '1.0.0')).toBe(0);
    expect(compareVersions('1.0.0+a', '1.0.0+b')).toBe(0);
  });

  it('should sort a prerelease before the release', () => {
    expect(compareVersions('1.0.0-beta.1', '1.0.0')).toBe(-1);
    expect(compareVersions('1.0.0', '1.0.0-rc.1')).toBe(1);
  });

  it('should compare prerelease identifiers like semver', () => {
    const order = [
      '1.0.0-alpha',
      '1.0.0-alpha.1',
      '1.0.0-alpha.beta',
      '1.0.0-beta',
      '1.0.0-beta.2',
      '1.0.0-beta.11',
      '1.0.0-rc.1',
      '1.0.0',
    ];
    for (let i = 0; i < order.length - 1; i++) {
      expect(compareVersions(order[i]!, order[i + 1]!)).toBe(-1);
      expect(compareVersions(order[i + 1]!, order[i]!)).toBe(1);
    }
  });

  it('should return undefined for versions that are not semver', () => {
    expect(compareVersions('1.0', '1.0.1')).toBeUndefined();
    expect(compareVersions('abc123', '1.0.0')).toBeUndefined();
  });
});

describe('bumpOf', () => {
  it('should tell how big a change is', () => {
    expect(bumpOf('1.2.3', '2.0.0')).toBe('major');
    expect(bumpOf('1.2.3', '1.3.0')).toBe('minor');
    expect(bumpOf('1.2.3', '1.2.4')).toBe('patch');
    expect(bumpOf('1.0.0-beta.1', '1.0.0-beta.2')).toBe('prerelease');
    expect(bumpOf('1.0.0-beta.1', '1.0.0')).toBe('prerelease');
  });

  it('should not depend on the direction', () => {
    expect(bumpOf('2.0.0', '1.2.3')).toBe('major');
    expect(bumpOf('1.1.1', '1.0.1')).toBe('minor');
  });

  it('should return undefined without a change or for other versions', () => {
    expect(bumpOf('1.0.0', '1.0.0')).toBeUndefined();
    expect(bumpOf('1.0.0+a', '1.0.0+b')).toBeUndefined();
    expect(bumpOf('abc', '1.0.0')).toBeUndefined();
  });
});

describe('sortVersions', () => {
  it('should sort from old to new and put other versions in text order', () => {
    expect(['1.10.0', '1.2.0', 'b', 'a', '1.2.0-rc.1'].sort(sortVersions)).toEqual([
      '1.2.0-rc.1',
      '1.2.0',
      '1.10.0',
      'a',
      'b',
    ]);
  });
});
