import { keyOf, type LockEntry } from '@lockfiles/parse';
import type { EnrichedField, EnrichReport, EnrichSource } from './types.js';

/** Fills fields of entries and keeps track of what was filled and where it came from. */
export class Tracker {
  readonly report: EnrichReport = { filled: {}, sources: new Map(), unresolved: [], failed: [] };

  /** Sets a field if the entry has no value for it yet. Values from the lockfile are never replaced. */
  set(entry: LockEntry, field: EnrichedField, value: unknown, source: EnrichSource): void {
    const target = entry as unknown as Record<string, unknown>;
    if (value === undefined || target[field] !== undefined) return;
    target[field] = value;
    this.record(entry, field, source);
  }

  /** Remembers a value that was set by someone else, for example by `inferScopes`. */
  record(entry: LockEntry, field: EnrichedField, source: EnrichSource): void {
    const key = keyOf(entry.name, entry.version);
    const sources = this.report.sources.get(key) ?? {};
    sources[field] = source;
    this.report.sources.set(key, sources);
    this.report.filled[field] = (this.report.filled[field] ?? 0) + 1;
  }
}
