/**
 * Runs `worker` for every item, with at most `size` calls at the same time.
 *
 * @template T - The type of items to process.
 * @param items - The array of items to process.
 * @param size - The maximum number of concurrent calls.
 * @param worker - The async function to run for each item.
 * @returns A promise that resolves when all items have been processed.
 */
export async function pool<T>(
  items: readonly T[],
  size: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  const run = async (): Promise<void> => {
    while (next < items.length) {
      await worker(items[next++]!);
    }
  };
  const workers = Math.max(1, Math.min(size, items.length));
  await Promise.all(Array.from({ length: workers }, run));
}

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Adds the cause to the message, because `fetch failed` alone does not say why it failed. */
export function describeError(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const { cause } = error;
  if (!(cause instanceof Error)) return error.message;
  const code = (cause as { code?: unknown }).code;
  const detail = cause.message || (typeof code === 'string' ? code : '');
  return detail ? `${error.message}: ${detail}` : error.message;
}
