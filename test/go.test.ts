import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test, describe } from 'node:test';

import { parseGo, formatGo } from '../src/go.ts';
import { GoDurationError } from '../src/errors.ts';

describe('parseGo — hand-written cases from the task spec', () => {
  test('parses compound durations', () => {
    assert.equal(parseGo('1h30m').ns, 5_400_000_000_000n);
    assert.equal(parseGo('-1.5s').ns, -1_500_000_000n);
    assert.equal(parseGo('300ms').ns, 300_000_000n);
    assert.equal(parseGo('2h45m30.5s').ns, 9_930_500_000_000n);
    assert.equal(parseGo('1µs').ns, 1_000n);
    assert.equal(parseGo('1us').ns, 1_000n);
    assert.equal(parseGo('1μs').ns, 1_000n); // GREEK SMALL LETTER MU, distinct from MICRO SIGN
  });

  test('the "0" special case: the only valid unitless input', () => {
    assert.equal(parseGo('0').ns, 0n);
    assert.equal(parseGo('-0').ns, 0n);
    assert.equal(parseGo('+0').ns, 0n);
  });

  test('rejects empty input, a bare number, and a malformed unit', () => {
    assert.throws(() => parseGo(''), GoDurationError);
    assert.throws(() => parseGo('1'), GoDurationError);
    assert.throws(() => parseGo('1hh'), GoDurationError);
    assert.throws(() => parseGo('.s'), GoDurationError);
  });

  test('exposes a convenience millisecond number alongside the exact bigint', () => {
    const d = parseGo('1h30m');
    assert.equal(d.ms, 5_400_000);
  });

  test('int64 nanosecond overflow is rejected, and the boundary values are not', () => {
    assert.equal(parseGo('9223372036854775807ns').ns, 9_223_372_036_854_775_807n);
    assert.equal(parseGo('-9223372036854775808ns').ns, -9_223_372_036_854_775_808n);
    assert.throws(() => parseGo('9223372036854775808ns'), GoDurationError);
    assert.throws(() => parseGo('-9223372036854775809ns'), GoDurationError);
  });

  test('no whitespace is tolerated anywhere', () => {
    assert.throws(() => parseGo(' 1h'), GoDurationError);
    assert.throws(() => parseGo('1h '), GoDurationError);
    assert.throws(() => parseGo('1 h'), GoDurationError);
  });

  test('an unrecognized unit is a distinct error from a missing one', () => {
    assert.throws(() => parseGo('1x'), (e: unknown) => {
      assert.ok(e instanceof GoDurationError);
      assert.match((e as Error).message, /unknown unit/);
      return true;
    });
    assert.throws(() => parseGo('h'), (e: unknown) => {
      assert.ok(e instanceof GoDurationError);
      assert.match((e as Error).message, /invalid duration/);
      return true;
    });
  });

  test('repeating a unit sums rather than erroring — this is real Go behavior, not a bug', () => {
    assert.equal(parseGo('1h1h').ns, 7_200_000_000_000n);
  });
});

describe('formatGo — hand-written cases from the task spec', () => {
  test('sub-second values print as ns/µs/ms with a trimmed fraction', () => {
    assert.equal(formatGo(0n), '0s');
    assert.equal(formatGo(100n), '100ns');
    assert.equal(formatGo(1_000n), '1µs');
    assert.equal(formatGo(1_500n), '1.5µs');
    assert.equal(formatGo(999_999_999n), '999.999999ms');
  });

  test('one second and up breaks into h/m/s, omitting absent higher units', () => {
    assert.equal(formatGo(1_000_000_000n), '1s');
    assert.equal(formatGo(5_400_000_000_000n), '1h30m0s');
    assert.equal(formatGo(65_000_000_000n), '1m5s');
  });

  test('the int64 extremes format exactly as time.Duration.String() does', () => {
    assert.equal(formatGo(9_223_372_036_854_775_807n), '2562047h47m16.854775807s');
    assert.equal(formatGo(-9_223_372_036_854_775_808n), '-2562047h47m16.854775808s');
  });

  test('formatGo(parseGo(s).ns) round-trips to the canonical spelling', () => {
    const cases: Array<[string, string]> = [
      ['1h30m', '1h30m0s'],
      ['2h45m30.5s', '2h45m30.5s'],
      ['300ms', '300ms'],
      ['1µs', '1µs'],
      ['1us', '1µs'], // ASCII spelling in, canonical µ spelling out
      ['-1.5s', '-1.5s'],
    ];
    for (const [input, canonical] of cases) {
      assert.equal(formatGo(parseGo(input).ns), canonical);
    }
  });
});

describe('differential against real time.ParseDuration / time.Duration.String()', () => {
  const parseFixtures = JSON.parse(fs.readFileSync(new URL('./fixtures/go-parse.json', import.meta.url), 'utf8')) as Array<
    { input: string; ok: true; ns: string } | { input: string; ok: false }
  >;
  const formatFixtures = JSON.parse(fs.readFileSync(new URL('./fixtures/go-format.json', import.meta.url), 'utf8')) as Array<{
    ns: string;
    expected: string;
  }>;

  test(`parseGo matches time.ParseDuration on ${parseFixtures.length} generated inputs`, () => {
    let failures = 0;
    const examples: string[] = [];
    for (const fx of parseFixtures) {
      let got: { ok: true; ns: string } | { ok: false };
      try {
        got = { ok: true, ns: parseGo(fx.input).ns.toString() };
      } catch {
        got = { ok: false };
      }
      const mismatch = fx.ok
        ? !got.ok || got.ns !== fx.ns
        : got.ok;
      if (mismatch) {
        failures++;
        if (examples.length < 5) examples.push(`${JSON.stringify(fx.input)}: want ${JSON.stringify(fx)} got ${JSON.stringify(got)}`);
      }
    }
    assert.equal(failures, 0, `${failures} mismatches, e.g.:\n${examples.join('\n')}`);
  });

  test(`formatGo matches time.Duration.String() on ${formatFixtures.length} generated int64 values`, () => {
    let failures = 0;
    const examples: string[] = [];
    for (const fx of formatFixtures) {
      const got = formatGo(BigInt(fx.ns));
      if (got !== fx.expected) {
        failures++;
        if (examples.length < 5) examples.push(`ns=${fx.ns}: want ${fx.expected} got ${got}`);
      }
    }
    assert.equal(failures, 0, `${failures} mismatches, e.g.:\n${examples.join('\n')}`);
  });
});
