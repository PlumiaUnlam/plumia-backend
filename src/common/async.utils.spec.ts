import { mapSequentially } from './async.utils';

describe('mapSequentially', () => {
  it('maps values in order and passes their indexes', async () => {
    const result = await mapSequentially([3, 5, 8], async (value, index) =>
      Promise.resolve(value + index),
    );

    expect(result).toEqual([3, 6, 10]);
  });

  it('does not start the next mapping until the current one finishes', async () => {
    const started: number[] = [];

    await mapSequentially([1, 2, 3], async (value) => {
      started.push(value);
      await Promise.resolve();
      expect(started).toEqual(
        Array.from({ length: value }, (_, index) => index + 1),
      );
      return value;
    });

    expect(started).toEqual([1, 2, 3]);
  });
});
