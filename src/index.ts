export * from './errors.ts';
export { parseGo, formatGo } from './go.ts';
export type { GoDuration } from './go.ts';
export { parseISO, formatISO, toNanoseconds } from './iso.ts';
export type { IsoDurationComponents, ToNanosecondsOptions } from './iso.ts';

import { DurationError } from './errors.ts';
import { parseGo, formatGo, type GoDuration } from './go.ts';
import { parseISO, formatISO, type IsoDurationComponents } from './iso.ts';

/** What grammar a `parse`d string turned out to be. */
export type DurationGrammar = 'go' | 'iso';

export type ParsedDuration =
  | ({ grammar: 'go' } & GoDuration)
  | ({ grammar: 'iso' } & IsoDurationComponents);

/**
 * Parses either grammar, auto-detected from the input's shape: a string starting
 * with an optional sign and then `P`/`p` is treated as ISO 8601 (`parseISO`);
 * anything else is treated as Go-style (`parseGo`). This is a shape check only, so
 * it never misdetects — the two grammars share no valid non-empty prefix other than
 * that leading `[sign] P`.
 *
 * The two branches return different shapes (nanoseconds for Go-style, calendar
 * components for ISO 8601 — the whole point of this library is that those are not
 * silently interchangeable). Check `.grammar` to narrow, or call `parseGo`/`parseISO`
 * directly when you already know which one you're expecting.
 */
export function parse(input: string): ParsedDuration {
  if (looksLikeIso(input)) {
    return { grammar: 'iso', ...parseISO(input) };
  }
  return { grammar: 'go', ...parseGo(input) };
}

function looksLikeIso(input: string): boolean {
  let i = 0;
  if (input[i] === '+' || input[i] === '-') i++;
  return input[i] === 'P' || input[i] === 'p';
}

/**
 * Formats a parsed duration back to a string in its own grammar — the inverse of
 * `parse`. For a `'go'` value this is `formatGo(value.ns)`; for `'iso'` it is
 * `formatISO(value)`.
 */
export function format(value: ParsedDuration): string {
  if (value.grammar === 'go') return formatGo(value.ns);
  if (value.grammar === 'iso') return formatISO(value);
  throw new DurationError(`unreachable: unknown grammar ${JSON.stringify((value as { grammar: unknown }).grammar)}`);
}
