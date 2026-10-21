import type { LockEntry } from '@lockfiles/parse';
import type { ChangedPackage, FormatOptions, LockfileDiff } from './types.js';

const versions = (entries: LockEntry[]): string => entries.map((e) => e.version).join(', ');

const describeChange = (change: ChangedPackage): string =>
  change.direction ? [change.bump, change.direction].filter(Boolean).join(' ') : '';

function summary(diff: LockfileDiff): string {
  const parts = [
    `${diff.added.length} added`,
    `${diff.removed.length} removed`,
    `${diff.changed.length} updated`,
  ];
  if (diff.integrityChanged.length > 0) {
    parts.push(`${diff.integrityChanged.length} with changed integrity`);
  }
  return parts.join(', ');
}

function formatText(diff: LockfileDiff): string {
  const lines = [summary(diff), ''];
  for (const entry of diff.added) lines.push(`+ ${entry.name}@${entry.version}`);
  for (const entry of diff.removed) lines.push(`- ${entry.name}@${entry.version}`);
  for (const change of diff.changed) {
    const note = describeChange(change);
    lines.push(
      `~ ${change.name} ${versions(change.before) || '-'} -> ${versions(change.after) || '-'}${note ? ` (${note})` : ''}`,
    );
  }
  for (const { before } of diff.integrityChanged) {
    lines.push(`! ${before.name}@${before.version} has a different integrity hash`);
  }
  return lines.join('\n');
}

function formatMarkdown(diff: LockfileDiff): string {
  const lines = ['## Dependency changes', '', summary(diff)];

  if (diff.integrityChanged.length > 0) {
    lines.push('', '### Integrity changed', '');
    lines.push(
      '> [!WARNING]',
      '> The same version has a different integrity hash in the new lockfile.',
      '',
    );
    for (const { before } of diff.integrityChanged)
      lines.push(`- \`${before.name}@${before.version}\``);
  }

  if (diff.changed.length > 0) {
    lines.push('', '### Updated', '');
    lines.push('| Package | Before | After | Change |', '| --- | --- | --- | --- |');
    for (const change of diff.changed) {
      lines.push(
        `| \`${change.name}\` | ${versions(change.before) || '-'} | ${versions(change.after) || '-'} | ${describeChange(change)} |`,
      );
    }
  }

  if (diff.added.length > 0) {
    lines.push('', '### Added', '');
    for (const entry of diff.added) lines.push(`- \`${entry.name}@${entry.version}\``);
  }

  if (diff.removed.length > 0) {
    lines.push('', '### Removed', '');
    for (const entry of diff.removed) lines.push(`- \`${entry.name}@${entry.version}\``);
  }

  return lines.join('\n');
}

/**
 * Turns a diff into text that people can read, as plain text or as Markdown (for example for a pull request comment).
 */
export function formatDiff(diff: LockfileDiff, options: FormatOptions = {}): string {
  if (diff.isEmpty)
    return options.format === 'markdown' ? '## Dependency changes\n\nNo changes.' : 'No changes.';
  return options.format === 'markdown' ? formatMarkdown(diff) : formatText(diff);
}
