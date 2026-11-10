import { describe, expect, test } from 'bun:test';
import { createDeadline } from './deadline';

class Expired extends Error {}

// `await expect(...).rejects` trips the await-thenable lint, so settle to the error instead.
const settle = (promise: Promise<unknown>) =>
  promise.then(
    () => 'resolved',
    (error: unknown) => error,
  );

const throws = (fn: () => void): unknown => {
  try {
    fn();
    return 'returned';
  } catch (error) {
    return error;
  }
};

describe('createDeadline', () => {
  test('an operation that blocks past the deadline and then resolves is still rejected', async () => {
    const deadline = createDeadline(5, () => new Expired());
    // The timer cannot fire while the event loop is blocked, so only the check after the race sees it.
    const outcome = await settle(
      deadline.wait(async () => {
        Bun.sleepSync(20);
        return 'late';
      }),
    );
    expect(outcome).toBeInstanceOf(Expired);
    expect(deadline.signal.aborted).toBe(true);
    deadline.dispose();
  });

  test('expiry rejects wait with the onExpire error and aborts the signal', async () => {
    const deadline = createDeadline(10, () => new Expired());
    const outcome = await settle(
      deadline.wait(() => new Promise<never>(() => {})),
    );
    expect(outcome).toBeInstanceOf(Expired);
    expect(deadline.signal.aborted).toBe(true);
    deadline.dispose();
  });

  test('check throws the onExpire error after expiry', async () => {
    const deadline = createDeadline(5, () => new Expired());
    expect(throws(deadline.check)).toBe('returned');
    await Bun.sleep(15);
    expect(throws(deadline.check)).toBeInstanceOf(Expired);
    expect(deadline.signal.aborted).toBe(true);
    deadline.dispose();
  });

  test('check observes an expiry the timer could not report and aborts', () => {
    const deadline = createDeadline(5, () => new Expired());
    // Blocks the event loop, so the timer cannot fire before check runs.
    Bun.sleepSync(15);
    expect(throws(deadline.check)).toBeInstanceOf(Expired);
    expect(deadline.signal.aborted).toBe(true);
    deadline.dispose();
  });

  test('without timeoutMs nothing expires', async () => {
    const deadline = createDeadline(undefined, () => new Expired());
    expect(await deadline.wait(async () => 'value')).toBe('value');
    await Bun.sleep(5);
    expect(throws(deadline.check)).toBe('returned');
    expect(deadline.signal.aborted).toBe(false);
    deadline.dispose();
  });

  test('dispose clears the timer and does not abort', async () => {
    let expiries = 0;
    const deadline = createDeadline(5, () => {
      expiries++;
      return new Expired();
    });
    deadline.dispose();
    await Bun.sleep(15);
    expect(expiries).toBe(0);
    expect(deadline.signal.aborted).toBe(false);
  });

  test('after dispose a late check still throws but never aborts', async () => {
    const deadline = createDeadline(1_000, () => new Expired());
    deadline.dispose();
    expect(throws(deadline.check)).toBeInstanceOf(Expired);
    expect(deadline.signal.aborted).toBe(false);
    await Bun.sleep(5);
    expect(throws(deadline.check)).toBeInstanceOf(Expired);
    expect(deadline.signal.aborted).toBe(false);
  });
});
