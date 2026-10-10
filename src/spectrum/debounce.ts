// Collects items per key until `delayMs()` passes with no new item, then handles them as one batch.
// Each add() resolves once the batch it joined has been handled, so callers (and tests) can await it.
// Batches for the same key run one at a time, in order: a batch that closes while the previous one
// is still being handled waits for it. If `handle` throws, the error is logged and waiters still resolve.

type Pending<T> = { items: T[]; timer?: ReturnType<typeof setTimeout>; waiters: (() => void)[] };

export function createBatcher<T>(delayMs: () => number, handle: (key: string, items: T[]) => Promise<void>) {
  const pending = new Map<string, Pending<T>>();
  const running = new Map<string, Promise<void>>(); // the latest batch queued or running, per key

  function runBatch(key: string, batch: Pending<T>): void {
    const previous = running.get(key) ?? Promise.resolve();
    const run = previous.then(async () => {
      try {
        await handle(key, batch.items);
      } catch (err) {
        console.error("[karl] batch handler failed", err);
      } finally {
        for (const done of batch.waiters) done();
      }
    });
    running.set(key, run);
    void run.then(() => {
      if (running.get(key) === run) running.delete(key);
    });
  }

  return (key: string, item: T): Promise<void> =>
    new Promise((resolve) => {
      const batch = pending.get(key) ?? { items: [], waiters: [] };
      pending.set(key, batch);
      batch.items.push(item);
      batch.waiters.push(resolve);
      clearTimeout(batch.timer);
      batch.timer = setTimeout(() => {
        pending.delete(key);
        runBatch(key, batch);
      }, delayMs());
    });
}
