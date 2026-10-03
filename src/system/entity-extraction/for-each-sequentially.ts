export function forEachSequentially<T>(
  items: Iterable<T>,
  action: (item: T) => Promise<void>,
): Promise<void> {
  let pending: Promise<void> = Promise.resolve();
  for (const item of items) {
    pending = pending.then(() => action(item));
  }
  return pending;
}
