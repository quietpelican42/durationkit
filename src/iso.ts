import { AmbiguousDurationError, IsoDurationError } from './errors.ts';

/**
 * The parsed components of an ISO 8601 duration. All seven fields are always
 * present (unspecified ones are `0`) and always share the same sign — a negative
 * duration (`-P1D`) has `days: -1`, not a separate sign flag, mirroring
 * `Temporal.Duration`. Any one field may carry a fractional value; the grammar
 * restricts that to the smallest component actually present in the source string
 * (see `parseISO`), but nothing stops a caller from constructing a components
 * object by hand with several fractional fields, so `formatISO` accepts that too.
 */
export interface IsoDurationComponents {
  years: number;
  months: number;
  weeks: number;
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
}

const ZERO: IsoDurationComponents = {
  years: 0,
  months: 0,
  weeks: 0,
  days: 0,
  hours: 0,
  minutes: 0,
  seconds: 0,
};

const DATE_DESIGNATORS = ['Y', 'M', 'W', 'D'] as const;
const TIME_DESIGNATORS = ['H', 'M', 'S'] as const;

/**
 * Parses an ISO 8601 duration (`P1DT2H`, `PT0.5S`, `P1W`, `-P1D`, `P1Y2M`) into its
 * component fields. Never guesses a fixed length for calendar components — that is
 * what `toNanoseconds` is for, and it demands a `relativeTo` anchor or
 * `{ daysAre24h: true }` before it will produce one.
 *
 * Grammar (ISO 8601-1 §5.5.3.2, with two ISO 8601-2 extensions this library takes a
 * documented position on):
 * - `[sign] "P" [n"Y"] [n"M"] [n"W"] [n"D"] ["T" [n"H"] [n"M"] [n"S"]]`, at least one
 *   component present.
 * - `n` is `digits ["." | "," digits]` — both `.` and `,` are accepted as the decimal
 *   separator (`,` is what the base standard actually specifies; `.` is the
 *   near-universal practice everyone actually writes and every reference
 *   implementation checked here accepts).
 * - **Fraction placement**: only the smallest component *present* in the string may
 *   carry a fraction (`PT1.5H` is invalid — `H` is not the smallest component when a
 *   fraction is used with nothing smaller following it... but here it *is* the only
 *   component, so it's fine; `P1.5DT2H` is invalid — `D` has a fraction but `H`
 *   follows it). This is the strict ISO 8601-1 rule and this parser enforces it.
 * - **Leading sign**: ISO 8601-1 has no sign; ISO 8601-2 adds an optional leading
 *   `+`/`-` before `P`. This library accepts it (needed for `-P1D`) and applies it to
 *   every component.
 * - **Week-mixing**: ISO 8601-1 treats `W` as an alternative representation used
 *   *alone* (`P1W`, nothing else). ISO 8601-2 permits combining it with the other
 *   date/time designators. This library follows ISO 8601-2 and allows `P1Y1W1D`,
 *   documented here rather than silently either accepting or rejecting it.
 *
 * Verified against `@js-temporal/polyfill`'s `Temporal.Duration.from` for component
 * parsing; see `test/fixtures/`.
 */
export function parseISO(input: string): IsoDurationComponents {
  const orig = input;
  let s = input;
  let sign = 1;

  if (s.length > 0 && (s[0] === '+' || s[0] === '-')) {
    sign = s[0] === '-' ? -1 : 1;
    s = s.slice(1);
  }

  if (s[0] !== 'P' && s[0] !== 'p') {
    throw new IsoDurationError(`invalid ISO 8601 duration ${JSON.stringify(orig)}: must start with "P"`);
  }
  s = s.slice(1);

  const [datePart, timePartRaw] = splitOnT(s, orig);

  const result: Record<string, number> = { years: 0, months: 0, weeks: 0, days: 0, hours: 0, minutes: 0, seconds: 0 };
  let anyComponent = false;

  const dateFields = tokenize(datePart, DATE_DESIGNATORS, orig);
  const timeFields = timePartRaw !== undefined ? tokenize(timePartRaw, TIME_DESIGNATORS, orig) : [];

  if (timePartRaw !== undefined && timeFields.length === 0) {
    throw new IsoDurationError(`invalid ISO 8601 duration ${JSON.stringify(orig)}: "T" with no time components`);
  }

  const allFields = [...dateFields, ...timeFields];
  if (allFields.length === 0) {
    throw new IsoDurationError(`invalid ISO 8601 duration ${JSON.stringify(orig)}: no components`);
  }

  const nameFor: Record<string, keyof IsoDurationComponents> = {
    Y: 'years',
    M_DATE: 'months',
    W: 'weeks',
    D: 'days',
    H: 'hours',
    M_TIME: 'minutes',
    S: 'seconds',
  };

  for (let idx = 0; idx < allFields.length; idx++) {
    const field = allFields[idx]!;
    const isLast = idx === allFields.length - 1;
    if (field.hasFraction && !isLast) {
      throw new IsoDurationError(
        `invalid ISO 8601 duration ${JSON.stringify(orig)}: only the smallest (last) component may have a fraction`,
      );
    }
    const key = nameFor[field.tag]!;
    if (result[key] !== 0) {
      throw new IsoDurationError(`invalid ISO 8601 duration ${JSON.stringify(orig)}: duplicate "${field.designator}"`);
    }
    result[key] = sign * field.value;
    anyComponent = true;
  }

  if (!anyComponent) {
    throw new IsoDurationError(`invalid ISO 8601 duration ${JSON.stringify(orig)}: no components`);
  }

  return { ...ZERO, ...result } as IsoDurationComponents;
}

function splitOnT(s: string, orig: string): [string, string | undefined] {
  const i = s.indexOf('T');
  const iLower = s.indexOf('t');
  const pos = i === -1 ? iLower : iLower === -1 ? i : Math.min(i, iLower);
  if (pos === -1) return [s, undefined];
  const datePart = s.slice(0, pos);
  const timePart = s.slice(pos + 1);
  if (timePart === '') {
    throw new IsoDurationError(`invalid ISO 8601 duration ${JSON.stringify(orig)}: "T" with no time components`);
  }
  return [datePart, timePart];
}

interface Field {
  tag: string;
  designator: string;
  value: number;
  hasFraction: boolean;
}

/**
 * Splits `s` (either the date-part or the time-part substring) into
 * `<number><designator>` fields, in the order the designators are given (which
 * enforces the required ordering — `P1D1Y` is rejected because `Y` won't be found
 * after `D` has already consumed the front of the remaining designator list).
 */
function tokenize(s: string, designators: readonly string[], orig: string): Field[] {
  const fields: Field[] = [];
  let rest = s;
  let di = 0;
  // The date part's "M" (month) and the time part's "M" (minute) share a letter;
  // disambiguate by which designator list is in play.
  const tagFor = (d: string): string => {
    if (d !== 'M') return d;
    return designators === DATE_DESIGNATORS ? 'M_DATE' : 'M_TIME';
  };

  while (rest !== '') {
    // Find the next designator this field must end with: scan forward from the
    // current allowed position for the first character that is a designator letter.
    const numMatch = /^([0-9]+(?:[.,][0-9]+)?)/.exec(rest);
    if (!numMatch) {
      throw new IsoDurationError(`invalid ISO 8601 duration ${JSON.stringify(orig)}: expected a number in "${rest}"`);
    }
    const numStr = numMatch[1]!;
    const after = rest.slice(numStr.length);
    if (after === '') {
      throw new IsoDurationError(`invalid ISO 8601 duration ${JSON.stringify(orig)}: missing designator after "${numStr}"`);
    }
    const designator = after[0]!;
    while (di < designators.length && designators[di] !== designator) di++;
    if (di === designators.length) {
      throw new IsoDurationError(
        `invalid ISO 8601 duration ${JSON.stringify(orig)}: unexpected or out-of-order designator "${designator}"`,
      );
    }
    const hasFraction = numStr.includes('.') || numStr.includes(',');
    const value = Number(numStr.replace(',', '.'));
    fields.push({ tag: tagFor(designator), designator, value, hasFraction });
    rest = after.slice(1);
    di++; // each designator may appear at most once, and only in increasing order
  }
  return fields;
}

/**
 * Formats duration components as an ISO 8601 string. Fields are emitted in
 * `Y M W D T H M S` order, each omitted when zero; an all-zero duration formats as
 * `PT0S`. A negative duration (any field negative — they must share one sign;
 * mixed-sign fields throw) is written with a single leading `-`, matching
 * `Temporal.Duration`'s own `toString()` convention rather than negating every field.
 */
export function formatISO(c: IsoDurationComponents): string {
  const values = [c.years, c.months, c.weeks, c.days, c.hours, c.minutes, c.seconds];
  const signs = new Set(values.filter((v) => v !== 0).map((v) => Math.sign(v)));
  if (signs.size > 1) {
    throw new IsoDurationError('duration components have mixed signs; all non-zero fields must share one sign');
  }
  const sign = signs.size === 0 ? 1 : ([...signs][0] as number);
  const abs = (n: number) => Math.abs(n);

  const datePart =
    fmtComponent(abs(c.years), 'Y') + fmtComponent(abs(c.months), 'M') + fmtComponent(abs(c.weeks), 'W') + fmtComponent(abs(c.days), 'D');
  const timePart = fmtComponent(abs(c.hours), 'H') + fmtComponent(abs(c.minutes), 'M') + fmtComponent(abs(c.seconds), 'S');

  let out = 'P' + datePart;
  if (timePart !== '') out += 'T' + timePart;
  if (datePart === '' && timePart === '') out = 'PT0S';

  return (sign < 0 ? '-' : '') + out;
}

function fmtComponent(n: number, designator: string): string {
  if (n === 0) return '';
  // Trim floating point noise (e.g. 0.1 + 0.2 style artifacts) without rounding away
  // a deliberate fraction; 9 significant decimal digits comfortably covers
  // nanosecond-derived seconds values.
  const str = trimFloat(n);
  return `${str}${designator}`;
}

function trimFloat(n: number): string {
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(9).replace(/0+$/, '').replace(/\.$/, '');
}

/** Options for resolving duration components to a fixed nanosecond count. */
export interface ToNanosecondsOptions {
  /**
   * The instant the duration is measured from — required whenever `years` or
   * `months` is non-zero (there is no fixed length for a month or a year without
   * one), and otherwise usable in place of `daysAre24h` when the caller does have
   * an anchor. Interpreted as a UTC calendar date and time; this library has no
   * timezone database, so DST transitions are not modeled (a "day" always advances
   * the calendar date by one, and always equals exactly 24h of elapsed time).
   */
  relativeTo?: Date;
  /**
   * Treat `weeks` and `days` as exactly 7×24h and 24h. Only valid when `years` and
   * `months` are both zero — there is no such flag for calendar components, by
   * design; pass `relativeTo` for those.
   */
  daysAre24h?: boolean;
}

/**
 * Resolves duration components to an exact nanosecond count. Throws
 * `AmbiguousDurationError` rather than guessing whenever the components don't
 * carry enough information to have one fixed length on their own:
 * - `years`/`months` always require `relativeTo` (a month is 28-31 days; a year is
 *   365-366).
 * - `weeks`/`days` require either `relativeTo` or `{ daysAre24h: true }` — even
 *   though this library's `relativeTo` is UTC-only and a UTC day is always 24h in
 *   practice, the two options exist to keep that assumption explicit rather than
 *   silent, and so the same call shape works if timezone-aware `relativeTo` support
 *   is added later.
 *
 * With `relativeTo`, calendar components are added using ISO 8601 "constrain"
 * semantics (adding a month past the 31st clamps to the target month's last day,
 * matching `Temporal.Duration.total`'s default `overflow: 'constrain'`), then the
 * fixed-length components are added as exact elapsed time, and the result is the
 * real elapsed nanoseconds between `relativeTo` and that computed instant.
 */
export function toNanoseconds(c: IsoDurationComponents, options: ToNanosecondsOptions = {}): bigint {
  const hasCalendar = c.years !== 0 || c.months !== 0;
  if (hasCalendar && !options.relativeTo) {
    throw new AmbiguousDurationError(
      'years/months have no fixed length in isolation; pass { relativeTo } to resolve them against a calendar date',
    );
  }
  if (!hasCalendar && !options.relativeTo && !options.daysAre24h) {
    throw new AmbiguousDurationError(
      'weeks/days need { relativeTo } or { daysAre24h: true } to become a fixed nanosecond count',
    );
  }

  if (options.relativeTo) {
    return relativeToNanoseconds(c, options.relativeTo);
  }

  // daysAre24h path: no calendar components, so this is pure fixed-length arithmetic.
  const totalMs =
    (c.weeks * 7 + c.days) * 86_400_000 + c.hours * 3_600_000 + c.minutes * 60_000 + c.seconds * 1000;
  return millisToNanosBigInt(totalMs);
}

function relativeToNanoseconds(c: IsoDurationComponents, relativeTo: Date): bigint {
  const startMs = relativeTo.getTime();
  if (!Number.isFinite(startMs)) {
    throw new IsoDurationError('relativeTo is not a valid Date');
  }

  let y = relativeTo.getUTCFullYear();
  let mo = relativeTo.getUTCMonth();
  const d = relativeTo.getUTCDate();
  const hh = relativeTo.getUTCHours();
  const mm = relativeTo.getUTCMinutes();
  const ss = relativeTo.getUTCSeconds();
  const ms = relativeTo.getUTCMilliseconds();

  y += Math.trunc(c.years);
  mo += Math.trunc(c.months);
  y += Math.floor(mo / 12);
  mo = ((mo % 12) + 12) % 12;

  const daysInTargetMonth = new Date(Date.UTC(y, mo + 1, 0)).getUTCDate();
  const day = Math.min(d, daysInTargetMonth);

  const baseMs = Date.UTC(y, mo, day, hh, mm, ss, ms);
  const extraMs = (c.weeks * 7 + c.days) * 86_400_000 + c.hours * 3_600_000 + c.minutes * 60_000 + c.seconds * 1000;
  const totalMs = baseMs + extraMs;

  return millisToNanosBigInt(totalMs - startMs);
}

/** `ms` may be fractional (sub-millisecond seconds); round to the nearest ns. */
function millisToNanosBigInt(ms: number): bigint {
  return BigInt(Math.round(ms * 1_000_000));
}
