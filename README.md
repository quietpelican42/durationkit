# durationkit

Parses and formats both Go-style compound durations (`1h30m`) and ISO 8601 durations (`P1DT2H`) through one API, with exact `time.ParseDuration` semantics and no silent guessing about how long a day or a month is.

```ts
import { parseGo, formatGo, parseISO, toNanoseconds } from 'durationkit';

parseGo('1h30m').ns;                 // 5400000000000n
formatGo(5_400_000_000_000n);        // "1h30m0s"

const c = parseISO('P1DT2H');        // { years:0, months:0, weeks:0, days:1, hours:2, minutes:0, seconds:0 }
toNanoseconds(c, { daysAre24h: true }); // 93600000000000n
```

## Why

The most-downloaded package for this, `parse-duration` (2,958,996 downloads/month), silently drops the date part of an ISO 8601 duration whenever a time part follows it:

Measured: `node -e "console.log(require('parse-duration').default('P1DT2H'))"`

```
7200000
```

That's 2 hours in milliseconds — the leading `P1D` (one day) vanished with no error and no warning. The correct value is 93600000 (1 day + 2 hours). It gets `P1D` alone right, and it gets the non-ISO compound form (`1D2H`) right, so this is not a case of the format being unsupported — it silently returns a wrong number for the exact form its own documentation advertises.

The other incumbents checked each cover one half of the problem, not both:

- `iso8601-duration` parses `P1DT2H` correctly but throws on `1h30m` — no Go-style support.
- `luxon`'s `Duration.fromISO` is correct on ISO 8601 but `.isValid` is `false` for `1h30m` — same gap, plus a full calendar library for one function.
- `tinyduration` is correct on `P1DT2H` but throws `Invalid duration` on `1h30m`.
- `ms` and `@lukeed/ms` return `undefined` for both forms — neither grammar.
- `Temporal.Duration` (via `@js-temporal/polyfill`) parses ISO 8601 correctly and has genuinely good calendar-arithmetic semantics (`total({ relativeTo })`), but has no Go-style grammar at all, and is a much larger dependency for a project that only wants durations.

Two independent, hand-rolled `parseDuration` reimplementations (found via `gh search code`) have their own bugs: `google-github-actions/actions-utils` returns `0` instead of throwing for a bare unit letter (`parseDuration('h')`) and silently accepts duplicate units; `shipzero/zero`'s regex-based parser drops the leading sign on negative input (`parseDuration('-5h')` returns a positive number) and does not check that the whole string was consumed, so `parseDuration('nonsense1h30mnonsense')` parses instead of throwing.

Given all of that, the value durationkit adds is narrower than "nobody else parses ISO 8601 durations" — Temporal and several small packages do that correctly. It is: exact Go-grammar parsing (verified bit-for-bit against `time.ParseDuration` itself), one API for both grammars instead of picking a library per format, and calendar components that refuse to become a fixed length unless the caller says how.

## Installation

```sh
npm install durationkit
```

Node >= 20.6. Zero runtime dependencies.

## Usage

### Go-style durations

```ts
import { parseGo, formatGo } from 'durationkit';

const d = parseGo('2h45m30.5s');
d.ns;   // 9930500000000n  — exact int64 nanoseconds, as Go's time.Duration stores it
d.ms;   // 9930500.5       — convenience number; loses precision past ~104 days of ns

formatGo(d.ns); // "2h45m30.5s"
```

`parseGo` throws `GoDurationError` on anything `time.ParseDuration` itself would reject: `""`, `"1"` (a number with no unit), `"1hh"` (unknown unit), `".s"` (no digits), int64 overflow, and any whitespace.

### ISO 8601 durations

```ts
import { parseISO, formatISO, toNanoseconds } from 'durationkit';

const c = parseISO('P1Y2M3DT4H5M6S');
// { years: 1, months: 2, weeks: 0, days: 3, hours: 4, minutes: 5, seconds: 6 }

formatISO(c); // "P1Y2M3DT4H5M6S"
```

`parseISO` always returns the raw components — it never collapses them to a length on its own, because `years` and `months` don't have one (a month is 28, 29, 30 or 31 days). To get a nanosecond count, resolve them explicitly:

```ts
// Fixed-length components only (no years/months): say what a day is worth.
toNanoseconds(parseISO('P1DT2H'), { daysAre24h: true }); // 93600000000000n

// Calendar components: measure against a real date instead of guessing.
toNanoseconds(parseISO('P1M'), { relativeTo: new Date('2024-01-31T00:00:00Z') });
// 2505600000000000n — Jan 31 -> Feb 29 (2024 is a leap year), 29 days, not a fixed "30 days"

// No anchor and a calendar component: throws rather than assuming 30 days.
toNanoseconds(parseISO('P1M')); // throws AmbiguousDurationError
```

### Auto-detecting the grammar

```ts
import { parse, format } from 'durationkit';

parse('1h30m');   // { grammar: 'go', ns: 5400000000000n, ms: 5400000 }
parse('P1DT2H');  // { grammar: 'iso', years: 0, months: 0, weeks: 0, days: 1, hours: 2, minutes: 0, seconds: 0 }

format(parse('1h30m'));  // "1h30m0s"
format(parse('P1DT2H')); // "P1DT2H"
```

Detection is a shape check, not a guess: a string starting with an optional sign then `P`/`p` is ISO 8601; everything else is Go-style. The two grammars share no other valid prefix, so this never misdetects.

## Reference

### `parseGo(input: string): GoDuration`

| Field | Type | Description |
| --- | --- | --- |
| `ns` | `bigint` | Exact nanosecond count (signed 64-bit range, like Go's `time.Duration`). |
| `ms` | `number` | `Number(ns) / 1e6`, for convenience. Loses precision past `Number.MAX_SAFE_INTEGER` ns (~104 days). |

Throws `GoDurationError`.

### `formatGo(ns: bigint): string`

Exact `time.Duration.String()` output. Throws `GoDurationError` if `ns` is outside the signed 64-bit range.

### `parseISO(input: string): IsoDurationComponents`

Returns `{ years, months, weeks, days, hours, minutes, seconds }`, all numbers, all sharing one sign. Throws `IsoDurationError`.

### `formatISO(components: IsoDurationComponents): string`

Inverse of `parseISO`. Throws `IsoDurationError` if the fields have inconsistent signs.

### `toNanoseconds(components, options?): bigint`

| Option | Type | Description |
| --- | --- | --- |
| `relativeTo` | `Date` | Anchor instant to resolve calendar components (`years`/`months`) or fixed-length ones against. Interpreted as UTC — see Limitations. |
| `daysAre24h` | `boolean` | Treat `weeks`/`days` as exactly 7×24h/24h. Rejected if `years` or `months` is non-zero. |

Throws `AmbiguousDurationError` if neither option resolves every non-zero field.

### `parse(input: string): ParsedDuration`

`{ grammar: 'go', ns, ms }` or `{ grammar: 'iso', years, months, weeks, days, hours, minutes, seconds }`.

### `format(value: ParsedDuration): string`

Dispatches to `formatGo` or `formatISO` based on `value.grammar`.

### Errors

`DurationError` is the common base. `GoDurationError` and `IsoDurationError` are parse/format failures; `AmbiguousDurationError` is `toNanoseconds` refusing to guess.

## How it works

`parseGo` is a direct reimplementation of `time.ParseDuration`'s algorithm — leading-integer and leading-fraction scanning with the same int64-magnitude overflow checks, using `bigint` throughout except for the one place Go itself uses `float64` (combining a fractional component with its unit), which is replicated with the same operation order so the two produce bit-identical results (both languages use IEEE 754 doubles). `formatGo` mirrors `time.Duration.String()`'s two branches: sub-second values print as a single number with a unit; a second and up breaks into `h`/`m`/`s`, omitting units with nothing above them.

`parseISO` tokenizes the date and time parts separately against their designator lists in order (`Y M W D`, then `H M S`), which naturally enforces both the required ordering and one-occurrence-per-designator. `toNanoseconds` only ever computes a length when told how: `daysAre24h` is pure fixed-length arithmetic; `relativeTo` adds calendar components to the anchor's UTC year/month/day (clamping to the target month's last day on overflow — the standard "constrain" rule, e.g. Jan 31 + 1 month lands on Feb 28 or 29) before adding the fixed-length remainder, then reports the real elapsed time between the anchor and that computed instant.

## Limitations

- `relativeTo` calendar arithmetic is UTC-only. There is no timezone database here, so a DST transition is invisible to it — a "day" always advances the UTC calendar date by exactly one and always equals exactly 24h of elapsed time. For timezone-aware relative arithmetic, resolve the components with `Temporal.Duration.total({ relativeTo })` instead (see the differential tests for how the two agree in UTC).
- `toNanoseconds` with `relativeTo` computes through a millisecond-resolution `Date` internally, so its result can be off by up to 1ms of true elapsed time versus true nanosecond-resolution calendar math (its own test fixtures apply that same tolerance).
- The ISO 8601-1 grammar as `parseISO` implements it allows a fraction on the smallest *present* component, including a date-part component like months (`P1Y6.5M` when nothing smaller follows) — `Temporal.Duration.from` is stricter and restricts fractions to the time part only. Both readings exist among real implementations; this is a documented choice, not a bug (see `test/iso.test.ts`).
- Week-mixing (`P1Y1W1D`) is accepted, following the ISO 8601-2 extension rather than the stricter ISO 8601-1 "weeks alone" reading — also a documented choice.
- No `Intl`/locale-aware formatting, no duration arithmetic (add/subtract/compare) beyond `toNanoseconds`, no `Temporal` interop helpers.

## Compatibility

Tested on Node 24 (the full TypeScript suite) and, against the built `dist/`, Node 20.6, 22 and 24 (CI matrix; run there, not locally verified here beyond Node 24).

## Development

```sh
npm install
npx tsc --noEmit
npm test              # unit tests + fixture-based differential replay
npm run build && npm run test:dist
```

The differential fixtures under `test/fixtures/` are pre-generated and committed so `npm test` needs nothing beyond Node. To regenerate them: `test/fixtures/generators/generate-go-fixtures.mjs` needs a local Go toolchain (`go run`); `test/fixtures/generators/generate-iso-fixtures.mjs` needs `@js-temporal/polyfill` installed ad hoc (`npm install --no-save @js-temporal/polyfill`) — neither is a dependency of the package itself.

## License

MIT
