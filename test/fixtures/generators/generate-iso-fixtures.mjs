// Regenerates test/fixtures/iso-components.json and iso-calendar.json by
// differential testing against @js-temporal/polyfill.
//
// Requires that package installed (it is NOT a devDependency of this package —
// this script is not run by `npm test`, only to regenerate its fixtures):
//
//   npm install --no-save @js-temporal/polyfill
//   node test/fixtures/generators/generate-iso-fixtures.mjs
//
// 1. Component parsing: random ISO 8601 duration strings, compared against
//    Temporal.Duration.from for the component breakdown.
// 2. Calendar arithmetic: random components resolved against a set of
//    month-end/leap-year anchor dates via toNanoseconds({ relativeTo }),
//    compared against Temporal.Duration.total({ unit: 'nanoseconds', relativeTo }).
import { Temporal } from '@js-temporal/polyfill';
import fs from 'node:fs';

function rngSeed(seed) {
  let s = seed >>> 0;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}
const rand = rngSeed(424242);
const randInt = (n) => Math.floor(rand() * n);

const CASES = [
  'P1DT2H', 'PT0.5S', 'P1W', '-P1D', 'P1Y2M', 'PT1H30M', 'P1Y6M4DT12H30M5S',
  'P2W', 'P1Y', 'P1M', 'PT1M', 'PT1S', 'P1D', 'PT0S', 'P0D', '-P1Y2M3DT4H5M6S',
  'PT0.000001S', 'P10Y', 'PT23H59M59.999999999S', 'P365D', 'P366D',
];

function randComponentCase() {
  const parts = [];
  const useY = rand() < 0.3, useMo = rand() < 0.3, useW = rand() < 0.2, useD = rand() < 0.4;
  const useH = rand() < 0.3, useMi = rand() < 0.3, useS = rand() < 0.4;
  if (useY) parts.push([randInt(20), 'Y']);
  if (useMo) parts.push([randInt(12), 'M']);
  if (useW) parts.push([randInt(10), 'W']);
  if (useD) parts.push([randInt(31), 'D']);
  const timeParts = [];
  if (useH) timeParts.push([randInt(24), 'H']);
  if (useMi) timeParts.push([randInt(60), 'M']);
  if (useS) timeParts.push([randInt(60) + (rand() < 0.5 ? rand() : 0), 'S']);
  if (parts.length === 0 && timeParts.length === 0) return null;
  let s = 'P' + parts.map(([v, u]) => `${v}${u}`).join('');
  if (timeParts.length) {
    s += 'T' + timeParts.map(([v, u]) => `${Number.isInteger(v) ? v : v.toFixed(6).replace(/0+$/, '').replace(/\.$/, '')}${u}`).join('');
  }
  if (rand() < 0.15) s = '-' + s;
  return s;
}

const inputs = new Set(CASES);
while (inputs.size < 2000) {
  const c = randComponentCase();
  if (c) inputs.add(c);
}

const componentFixtures = [];
for (const input of inputs) {
  let ok = true, want;
  try {
    const td = Temporal.Duration.from(input);
    want = {
      years: td.years, months: td.months, weeks: td.weeks, days: td.days,
      hours: td.hours, minutes: td.minutes,
      seconds: td.seconds + td.milliseconds / 1e3 + td.microseconds / 1e6 + td.nanoseconds / 1e9,
    };
  } catch {
    ok = false;
  }
  componentFixtures.push(ok ? { input, ok: true, want } : { input, ok: false });
}

// --- Calendar arithmetic fixtures ---
const anchors = [
  '2024-01-31T00:00:00Z', '2023-01-31T00:00:00Z', '2024-02-29T12:00:00Z',
  '2000-02-29T00:00:00Z', '2024-03-31T00:00:00Z', '2024-12-31T23:59:59Z',
  '2024-06-15T08:30:00Z', '1970-01-01T00:00:00Z', '2100-02-28T00:00:00Z',
];

function randCalCase() {
  const sign = rand() < 0.3 ? -1 : 1;
  const y = randInt(5), mo = randInt(28), w = randInt(6), d = randInt(60), h = randInt(48), mi = randInt(120), se = randInt(120);
  return {
    years: sign * y, months: sign * mo, weeks: sign * w, days: sign * d,
    hours: sign * h, minutes: sign * mi, seconds: sign * se,
  };
}

const calendarFixtures = [];
for (const anchor of anchors) {
  for (let i = 0; i < 60; i++) {
    const comp = randCalCase();
    const zdt = Temporal.Instant.from(anchor).toZonedDateTimeISO('UTC');
    const dur = Temporal.Duration.from(comp);
    let wantNs;
    try {
      wantNs = Math.round(dur.total({ unit: 'nanoseconds', relativeTo: zdt })).toString();
    } catch {
      wantNs = null;
    }
    calendarFixtures.push({ anchor, components: comp, wantNs });
  }
}

fs.writeFileSync(new URL('../iso-components.json', import.meta.url), JSON.stringify(componentFixtures));
fs.writeFileSync(new URL('../iso-calendar.json', import.meta.url), JSON.stringify(calendarFixtures));

console.log('component fixtures:', componentFixtures.length, 'calendar fixtures:', calendarFixtures.length);
