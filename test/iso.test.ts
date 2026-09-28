import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test, describe } from 'node:test';

import { parseISO, formatISO, toNanoseconds } from '../src/iso.ts';
import { IsoDurationError, AmbiguousDurationError } from '../src/errors.ts';

describe('parseISO — hand-written cases from the task spec', () => {
  test('parses the task spec examples', () => {
    assert.deepEqual(parseISO('P1DT2H'), { years: 0, months: 0, weeks: 0, days: 1, hours: 2, minutes: 0, seconds: 0 });
    assert.deepEqual(parseISO('PT0.5S'), { years: 0, months: 0, weeks: 0, days: 0, hours: 0, minutes: 0, seconds: 0.5 });
    assert.deepEqual(parseISO('P1W'), { years: 0, months: 0, weeks: 1, days: 0, hours: 0, minutes: 0, seconds: 0 });
    assert.deepEqual(parseISO('-P1D'), { years: 0, months: 0, weeks: 0, days: -1, hours: 0, minutes: 0, seconds: 0 });
    assert.deepEqual(parseISO('P1Y2M'), { years: 1, months: 2, weeks: 0, days: 0, hours: 0, minutes: 0, seconds: 0 });
  });

  test('comma is accepted as the decimal separator, same as a period', () => {
    assert.equal(parseISO('PT1,5S').seconds, 1.5);
    assert.equal(parseISO('PT1.5S').seconds, 1.5);
  });

  test('a fraction is only valid on the smallest component present', () => {
    assert.doesNotThrow(() => parseISO('P1Y6.5M')); // months is smallest present (no W/D/T)
    assert.doesNotThrow(() => parseISO('PT1.5H')); // hours is smallest present (no M/S)
    assert.throws(() => parseISO('P1.5DT2H'), IsoDurationError); // days has a fraction but hours follows
    assert.throws(() => parseISO('PT1.5H30M'), IsoDurationError); // hours has a fraction but minutes follows
  });

  test('week-mixing: this library follows ISO 8601-2 and allows combining weeks with other designators', () => {
    assert.deepEqual(parseISO('P1Y1W1D'), { years: 1, months: 0, weeks: 1, days: 1, hours: 0, minutes: 0, seconds: 0 });
  });

  test('a leading sign (ISO 8601-2) applies to every component', () => {
    assert.deepEqual(parseISO('-P1Y2M3DT4H5M6S'), {
      years: -1, months: -2, weeks: 0, days: -3, hours: -4, minutes: -5, seconds: -6,
    });
  });

  test('rejects malformed input', () => {
    assert.throws(() => parseISO(''), IsoDurationError); // no leading P
    assert.throws(() => parseISO('P'), IsoDurationError); // no components at all
    assert.throws(() => parseISO('PT'), IsoDurationError); // T with nothing after it
    assert.throws(() => parseISO('P1D1Y'), IsoDurationError); // out of order
    assert.throws(() => parseISO('P1D1D'), IsoDurationError); // duplicate designator
  });
});

describe('formatISO', () => {
  test('formats components back to an ISO 8601 string', () => {
    assert.equal(formatISO({ years: 0, months: 0, weeks: 0, days: 1, hours: 2, minutes: 0, seconds: 0 }), 'P1DT2H');
    assert.equal(formatISO({ years: 0, months: 0, weeks: 0, days: -1, hours: 0, minutes: 0, seconds: 0 }), '-P1D');
    assert.equal(formatISO({ years: 0, months: 0, weeks: 0, days: 0, hours: 0, minutes: 0, seconds: 0 }), 'PT0S');
    assert.equal(formatISO({ years: 0, months: 0, weeks: 0, days: 0, hours: 0, minutes: 0, seconds: 0.5 }), 'PT0.5S');
  });

  test('rejects components with inconsistent signs', () => {
    assert.throws(
      () => formatISO({ years: 1, months: 0, weeks: 0, days: -1, hours: 0, minutes: 0, seconds: 0 }),
      IsoDurationError,
    );
  });

  test('round-trips through parseISO', () => {
    for (const s of ['P1DT2H', 'P1Y2M3DT4H5M6S', '-P1W', 'PT0.5S', 'PT0S']) {
      assert.equal(formatISO(parseISO(s)), s);
    }
  });
});

describe('toNanoseconds — never guesses', () => {
  test('years/months without relativeTo throw', () => {
    assert.throws(() => toNanoseconds({ years: 1, months: 0, weeks: 0, days: 0, hours: 0, minutes: 0, seconds: 0 }), AmbiguousDurationError);
    assert.throws(() => toNanoseconds({ years: 0, months: 1, weeks: 0, days: 0, hours: 0, minutes: 0, seconds: 0 }), AmbiguousDurationError);
  });

  test('days/weeks without relativeTo or daysAre24h throw', () => {
    assert.throws(() => toNanoseconds({ years: 0, months: 0, weeks: 0, days: 1, hours: 0, minutes: 0, seconds: 0 }), AmbiguousDurationError);
  });

  test('{ daysAre24h: true } resolves days/weeks as exact fixed-length time', () => {
    const ns = toNanoseconds(
      { years: 0, months: 0, weeks: 1, days: 1, hours: 2, minutes: 0, seconds: 0 },
      { daysAre24h: true },
    );
    assert.equal(ns, BigInt((7 + 1) * 86_400 + 2 * 3600) * 1_000_000_000n);
  });

  test('{ daysAre24h: true } is rejected when years/months are present — no such flag for calendar units', () => {
    assert.throws(
      () => toNanoseconds({ years: 1, months: 0, weeks: 0, days: 0, hours: 0, minutes: 0, seconds: 0 }, { daysAre24h: true }),
      AmbiguousDurationError,
    );
  });

  test('relativeTo resolves a month-end overflow by constraining to the target month\'s last day', () => {
    // Jan 31 + 1 month: February has no 31st, so this constrains to Feb 29 in a leap year.
    const ns = toNanoseconds(
      { years: 0, months: 1, weeks: 0, days: 0, hours: 0, minutes: 0, seconds: 0 },
      { relativeTo: new Date('2024-01-31T00:00:00Z') },
    );
    assert.equal(ns, 29n * 86_400n * 1_000_000_000n); // Jan 31 -> Feb 29 is 29 days
  });

  test('relativeTo accounts for a leap year when adding a full year', () => {
    const ns = toNanoseconds(
      { years: 1, months: 0, weeks: 0, days: 0, hours: 0, minutes: 0, seconds: 0 },
      { relativeTo: new Date('2024-01-01T00:00:00Z') },
    );
    assert.equal(ns, 366n * 86_400n * 1_000_000_000n); // 2024 is a leap year
  });
});

describe('differential against @js-temporal/polyfill', () => {
  const componentFixtures = JSON.parse(
    fs.readFileSync(new URL('./fixtures/iso-components.json', import.meta.url), 'utf8'),
  ) as Array<{ input: string; ok: true; want: Record<string, number> } | { input: string; ok: false }>;
  const calendarFixtures = JSON.parse(
    fs.readFileSync(new URL('./fixtures/iso-calendar.json', import.meta.url), 'utf8'),
  ) as Array<{ anchor: string; components: Record<string, number>; wantNs: string | null }>;

  test(`parseISO matches Temporal.Duration.from's component breakdown on ${componentFixtures.length} generated inputs`, () => {
    let failures = 0;
    const examples: string[] = [];
    const close = (a: number, b: number) => Math.abs(a - b) < 1e-9;
    for (const fx of componentFixtures) {
      let got: ReturnType<typeof parseISO> | null;
      try {
        got = parseISO(fx.input);
      } catch {
        got = null;
      }
      let ok: boolean;
      if (!fx.ok) {
        ok = got === null;
      } else if (got === null) {
        ok = false;
      } else {
        ok =
          close(got.years, fx.want.years!) &&
          close(got.months, fx.want.months!) &&
          close(got.weeks, fx.want.weeks!) &&
          close(got.days, fx.want.days!) &&
          close(got.hours, fx.want.hours!) &&
          close(got.minutes, fx.want.minutes!) &&
          close(got.seconds, fx.want.seconds!);
      }
      if (!ok) {
        failures++;
        if (examples.length < 5) examples.push(`${JSON.stringify(fx.input)}: want ${JSON.stringify(fx)} got ${JSON.stringify(got)}`);
      }
    }
    assert.equal(failures, 0, `${failures} mismatches, e.g.:\n${examples.join('\n')}`);
  });

  test(`toNanoseconds({ relativeTo }) matches Temporal.Duration.total({ relativeTo }) on ${calendarFixtures.length} generated (anchor, components) pairs, including month-end and leap years`, () => {
    let failures = 0;
    const examples: string[] = [];
    for (const fx of calendarFixtures) {
      const anchorDate = new Date(fx.anchor);
      let gotNs: bigint | null;
      try {
        gotNs = toNanoseconds(fx.components as never, { relativeTo: anchorDate });
      } catch {
        gotNs = null;
      }
      let ok: boolean;
      if (fx.wantNs === null) {
        ok = gotNs === null;
      } else if (gotNs === null) {
        ok = false;
      } else {
        // 1ms slack: our relativeTo arithmetic goes through a millisecond-resolution Date internally.
        const diff = gotNs > BigInt(fx.wantNs) ? gotNs - BigInt(fx.wantNs) : BigInt(fx.wantNs) - gotNs;
        ok = diff <= 1_000_000n;
      }
      if (!ok) {
        failures++;
        if (examples.length < 5) {
          examples.push(`anchor=${fx.anchor} components=${JSON.stringify(fx.components)}: want ${fx.wantNs} got ${gotNs}`);
        }
      }
    }
    assert.equal(failures, 0, `${failures} mismatches, e.g.:\n${examples.join('\n')}`);
  });
});
