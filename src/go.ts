import { GoDurationError } from './errors.ts';

/** The result of `parseGo`. */
export interface GoDuration {
  /** Exact nanosecond count, as Go's `time.Duration` stores it (a signed 64-bit integer). */
  ns: bigint;
  /**
   * Convenience millisecond count (`Number(ns) / 1e6`). Loses precision once `ns`
   * exceeds `Number.MAX_SAFE_INTEGER` nanoseconds (~104 days); use `ns` for anything
   * that must round-trip exactly.
   */
  ms: number;
}

// int64 bounds, as BigInt: [-2^63, 2^63 - 1].
const I64_MAX = (1n << 63n) - 1n;
const I64_MIN = -(1n << 63n);
const TWO_POW_63 = 1n << 63n;

// Unit -> nanoseconds. Go recognizes exactly these spellings, case-sensitively,
// including both the ASCII "us" and the two Unicode micro-sign spellings.
const UNIT_NS: Record<string, bigint> = {
  ns: 1n,
  us: 1_000n,
  'µs': 1_000n, // µs, MICRO SIGN
  'μs': 1_000n, // μs, GREEK SMALL LETTER MU
  ms: 1_000_000n,
  s: 1_000_000_000n,
  m: 60_000_000_000n,
  h: 3_600_000_000_000n,
};

/**
 * Parses a Go-style compound duration (`1h30m`, `-1.5s`, `300ms`, `2h45m30.5s`,
 * `1µs`/`1us`), matching `time.ParseDuration` from Go's standard library exactly —
 * including its int64-nanosecond overflow behavior, its `"0"` special case (the only
 * unitless input that's valid), and its rejection of `""`, `"1"` (a number with no
 * unit), `"1hh"` (an unrecognized unit) and `".s"` (no digits on either side of the
 * point). Verified against `time.ParseDuration` itself over 20,000 generated inputs;
 * see `test/fixtures/`.
 *
 * Grammar: an optional leading `+`/`-` sign, then either the literal `0` or one or
 * more `<number><unit>` components run together with no separator (`2h45m30.5s`).
 * Each component's number is `digits ["." digits]`, with at least one digit somewhere
 * in it. Units: `ns`, `us`/`µs`/`μs`, `ms`, `s`, `m`, `h`. No whitespace is tolerated
 * anywhere. Repeating a unit is accepted (Go itself does not reject `1h1h`; it sums
 * to `2h`) and there is no day/week/month/year unit — that is exactly the gap
 * `parseISO` fills instead.
 */
export function parseGo(input: string): GoDuration {
  const orig = input;
  let s = input;
  let neg = false;

  if (s.length > 0 && (s[0] === '+' || s[0] === '-')) {
    neg = s[0] === '-';
    s = s.slice(1);
  }

  if (s === '0') return { ns: 0n, ms: 0 };
  if (s === '') throw new GoDurationError(`invalid duration ${JSON.stringify(orig)}`);

  const maxAbs = neg ? TWO_POW_63 : I64_MAX;
  let d = 0n; // running unsigned magnitude, in nanoseconds

  while (s !== '') {
    const c = s.charCodeAt(0);
    const isDigit = c >= 48 && c <= 57;
    if (s[0] !== '.' && !isDigit) {
      throw new GoDurationError(`invalid duration ${JSON.stringify(orig)}`);
    }

    // Leading integer digits.
    const beforeLen = s.length;
    const [intVal, afterInt] = leadingInt(s, orig);
    s = afterInt;
    // `pre` in Go's source: did we consume any integer digits at all (even "0").
    const pre = beforeLen !== s.length;

    // Optional fractional part.
    let fracVal = 0n;
    let scale = 1; // power of ten, as a plain number (mirrors Go's float64 `scale`)
    let post = false;
    if (s !== '' && s[0] === '.') {
      s = s.slice(1);
      const fracStart = s.length;
      const frac = leadingFraction(s);
      fracVal = frac.x;
      scale = frac.scale;
      s = frac.rest;
      post = fracStart !== s.length;
    }

    if (!pre && !post) {
      throw new GoDurationError(`invalid duration ${JSON.stringify(orig)}`);
    }

    // Unit: consume up to the next digit or '.' or end of string.
    let i = 0;
    while (i < s.length) {
      const uc = s.charCodeAt(i);
      if (uc === 46 /* '.' */ || (uc >= 48 && uc <= 57)) break;
      i++;
    }
    if (i === 0) {
      throw new GoDurationError(`missing unit in duration ${JSON.stringify(orig)}`);
    }
    const unitStr = s.slice(0, i);
    s = s.slice(i);
    const unit = UNIT_NS[unitStr];
    if (unit === undefined) {
      throw new GoDurationError(`unknown unit ${JSON.stringify(unitStr)} in duration ${JSON.stringify(orig)}`);
    }

    if (intVal > maxAbs / unit) {
      throw new GoDurationError(`invalid duration ${JSON.stringify(orig)}`);
    }
    let v = intVal * unit;

    if (fracVal > 0n) {
      // Go computes this component in float64: uint64(float64(f) * (float64(unit) / scale)).
      // Both languages use IEEE 754 doubles, so replicating the exact operation order
      // reproduces its rounding/truncation bit-for-bit (verified by the fixtures).
      const inc = Math.trunc(Number(fracVal) * (Number(unit) / scale));
      v += BigInt(inc);
      if (v > maxAbs) {
        throw new GoDurationError(`invalid duration ${JSON.stringify(orig)}`);
      }
    }

    d += v;
    if (d > maxAbs) {
      throw new GoDurationError(`invalid duration ${JSON.stringify(orig)}`);
    }
  }

  const ns = neg ? -d : d;
  if (ns < I64_MIN || ns > I64_MAX) {
    // Unreachable given the per-step checks above; kept as a hard backstop.
    throw new GoDurationError(`invalid duration ${JSON.stringify(orig)}`);
  }
  return { ns, ms: Number(ns) / 1e6 };
}

/** Consumes `[0-9]*` from the start of `s`, as an unsigned magnitude capped at 2^63. */
function leadingInt(s: string, orig: string): [bigint, string] {
  let i = 0;
  let x = 0n;
  const cap = 1n << 63n;
  while (i < s.length) {
    const c = s.charCodeAt(i);
    if (c < 48 || c > 57) break;
    if (x > cap / 10n) {
      throw new GoDurationError(`invalid duration ${JSON.stringify(orig)}`);
    }
    x = x * 10n + BigInt(c - 48);
    if (x > cap) {
      throw new GoDurationError(`invalid duration ${JSON.stringify(orig)}`);
    }
    i++;
  }
  return [x, s.slice(i)];
}

/**
 * Consumes `[0-9]*` as a fraction: `x` is the digit string's value, `scale` is
 * 10^(number of digits actually folded in). Unlike `leadingInt`, overflow here does
 * not fail the parse — Go just stops folding further digits into `x`/`scale` and
 * keeps consuming (and discarding) the rest, matching arbitrarily long fractions
 * like `0.999999999999999999999999999h`.
 */
function leadingFraction(s: string): { x: bigint; scale: number; rest: string } {
  let i = 0;
  let x = 0n;
  let scale = 1;
  let overflowed = false;
  const cap = (1n << 63n) - 1n;
  while (i < s.length) {
    const c = s.charCodeAt(i);
    if (c < 48 || c > 57) break;
    if (!overflowed) {
      if (x > cap / 10n) {
        overflowed = true;
      } else {
        const y = x * 10n + BigInt(c - 48);
        if (y > 1n << 63n) {
          overflowed = true;
        } else {
          x = y;
          scale *= 10;
        }
      }
    }
    i++;
  }
  return { x, scale, rest: s.slice(i) };
}

/**
 * Formats a nanosecond count exactly as Go's `time.Duration.String()` does: units
 * below a second use `ns`/`µs`/`ms` and print as a single number (`100ns`,
 * `999.999999ms`); a second and above are broken into `h`/`m`/`s` components with
 * the seconds component carrying any fractional remainder (`1h30m0s`,
 * `2562047h47m16.854775807s`, the int64-nanosecond extremes). Zero formats as `0s`.
 */
export function formatGo(ns: bigint): string {
  if (ns < I64_MIN || ns > I64_MAX) {
    throw new GoDurationError(`ns out of int64 range: ${ns}`);
  }
  if (ns === 0n) return '0s';

  const neg = ns < 0n;
  const u = neg ? -ns : ns; // safe: int64 min negated fits in a bigint (unlike Go's own int64)

  let out: string;
  if (u < 1_000_000_000n) {
    // Sub-second: ns, µs or ms, with a fractional part and no leading zero on the integer part.
    let prec: number;
    let unitStr: string;
    if (u < 1_000n) {
      prec = 0;
      unitStr = 'ns';
    } else if (u < 1_000_000n) {
      prec = 3;
      unitStr = 'µs';
    } else {
      prec = 6;
      unitStr = 'ms';
    }
    out = fmtFrac(u, prec) + unitStr;
  } else {
    // One second and up: h/m/s components, with any fractional remainder carried
    // by the seconds component. A unit with a zero magnitude above it is omitted
    // entirely (no "0h" prefix), matching Go's right-to-left construction.
    const fracSuffix = fmtFracSuffix(u % 1_000_000_000n, 9);
    const totalSecs = u / 1_000_000_000n;
    const secPart = totalSecs % 60n;
    const mins = totalSecs / 60n;

    let body = `${secPart}${fracSuffix}s`;
    if (mins > 0n) {
      const minPart = mins % 60n;
      const hours = mins / 60n;
      body = `${minPart}m${body}`;
      if (hours > 0n) body = `${hours}h${body}`;
    }
    out = body;
  }

  return neg ? '-' + out : out;
}

/**
 * Formats `u` as `<integer>.<fraction>` at `prec` decimal digits (dividing `u` by
 * 10^prec), trimming trailing zeros from the fraction and dropping the point
 * entirely when nothing survives — e.g. `fmtFrac(1500n, 3)` is `"1.5"`,
 * `fmtFrac(300n, 0)` is `"300"`. Mirrors Go's `fmtFrac` + `fmtInt` pair.
 */
function fmtFrac(u: bigint, prec: number): string {
  if (prec === 0) return String(u);
  const div = 10n ** BigInt(prec);
  const intPart = u / div;
  const frac = u % div;
  const fracStr = frac.toString().padStart(prec, '0').replace(/0+$/, '');
  return fracStr === '' ? String(intPart) : `${intPart}.${fracStr}`;
}

/**
 * Like `fmtFrac`, but returns only the `.<fraction>` suffix (or `""` when the
 * fraction is entirely trailing zeros) — used for the seconds component of the
 * h/m/s form, whose integer part is formatted separately.
 */
function fmtFracSuffix(u: bigint, prec: number): string {
  const div = 10n ** BigInt(prec);
  const frac = u % div;
  const fracStr = frac.toString().padStart(prec, '0').replace(/0+$/, '');
  return fracStr === '' ? '' : `.${fracStr}`;
}
