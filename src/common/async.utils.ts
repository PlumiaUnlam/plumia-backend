export function mapSequentially<T, R>(
  values: readonly T[],
  map: (value: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  let sequence = Promise.resolve();
  values.forEach((value, index) => {
    sequence = sequence.then(async () => {
      results.push(await map(value, index));
    });
  });
  return sequence.then(() => results);
}
