/**
 * Plain-JS checks against the built package, so they run on every Node version
 * in `engines` — the TypeScript suite needs type stripping and only runs on 24+.
 *
 *   npm run build && node --test test/smoke.mjs
 */
import assert from 'node:assert/strict';
import test from 'node:test';

const { parseGo, formatGo, parseISO, formatISO, toNanoseconds, parse, format } = await import('../dist/index.js');

test('parseGo / formatGo round-trip a compound duration', () => {
  const d = parseGo('1h30m');
  assert.equal(d.ns, 5_400_000_000_000n);
  assert.equal(formatGo(d.ns), '1h30m0s');
});

test('parseGo rejects the classic malformed inputs', () => {
  assert.throws(() => parseGo(''));
  assert.throws(() => parseGo('1'));
  assert.throws(() => parseGo('1hh'));
  assert.throws(() => parseGo('.s'));
});

test('parseISO gets the day part right where the well-known incumbent bug drops it', () => {
  const c = parseISO('P1DT2H');
  assert.deepEqual(c, { years: 0, months: 0, weeks: 0, days: 1, hours: 2, minutes: 0, seconds: 0 });
  assert.equal(toNanoseconds(c, { daysAre24h: true }), 93_600_000_000_000n);
});

test('formatISO round-trips', () => {
  assert.equal(formatISO(parseISO('-P1D')), '-P1D');
});

test('parse auto-detects the grammar and format dispatches on it', () => {
  assert.equal(parse('P1DT2H').grammar, 'iso');
  assert.equal(parse('1h30m').grammar, 'go');
  assert.equal(format(parse('1h30m')), '1h30m0s');
});

test('years/months resolve only with an explicit relativeTo, never guessed', () => {
  assert.throws(() => toNanoseconds(parseISO('P1Y')));
  const ns = toNanoseconds(parseISO('P1Y'), { relativeTo: new Date('2024-01-01T00:00:00Z') });
  assert.equal(ns, 366n * 86_400n * 1_000_000_000n);
});
