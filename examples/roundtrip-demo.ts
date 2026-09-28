/**
 * Demonstrates the gap this library exists for: parse-duration 2.1.9 silently
 * drops the date part of an ISO 8601 duration whenever a time part follows it.
 *
 *   node examples/roundtrip-demo.ts
 */
import { parseGo, formatGo, parseISO, formatISO, toNanoseconds, parse, format } from '../src/index.ts';

console.log('--- Go-style ---');
for (const s of ['1h30m', '-1.5s', '300ms', '2h45m30.5s', '1µs']) {
  const d = parseGo(s);
  console.log(`${s.padEnd(12)} -> ${d.ns} ns  -> formatGo -> ${formatGo(d.ns)}`);
}

console.log('\n--- ISO 8601 ---');
for (const s of ['P1DT2H', 'PT0.5S', 'P1W', '-P1D', 'P1Y2M']) {
  const c = parseISO(s);
  console.log(`${s.padEnd(10)} -> ${JSON.stringify(c)}`);
}

console.log('\n--- the actual bug this library is built to not have ---');
console.log('parse-duration 2.1.9: parseDuration("P1DT2H") -> 7200000   (drops the day)');
const c = parseISO('P1DT2H');
const ns = toNanoseconds(c, { daysAre24h: true });
console.log(`durationkit:          toNanoseconds(parseISO("P1DT2H"), { daysAre24h: true }) -> ${Number(ns / 1_000_000n)}`);

console.log('\n--- auto-detected parse/format ---');
console.log(format(parse('1h30m')), format(parse('P1DT2H')));

console.log('\n--- calendar components never silently become a length ---');
try {
  toNanoseconds(parseISO('P1Y2M'));
} catch (err) {
  console.log(`toNanoseconds(parseISO("P1Y2M")) with no relativeTo -> throws: ${(err as Error).message}`);
}
console.log(
  `toNanoseconds(parseISO("P1Y2M"), { relativeTo: 2024-01-01 }) -> ${toNanoseconds(parseISO('P1Y2M'), {
    relativeTo: new Date('2024-01-01T00:00:00Z'),
  })} ns`,
);
console.log(`formatISO round-trip: ${formatISO(parseISO('-P1Y2M3DT4H5M6S'))}`);
