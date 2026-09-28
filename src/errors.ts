/** Base class for every error this library throws. */
export class DurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** `parseGo` rejected the input: empty, missing/unknown unit, bad number, or int64 overflow. */
export class GoDurationError extends DurationError {}

/** `parseISO` rejected the input: it does not match the ISO 8601-1 duration grammar. */
export class IsoDurationError extends DurationError {}

/**
 * A caller asked to convert calendar components (years, months, or — under
 * the default policy — days) to a fixed-length duration without saying how
 * long a day, month or year is. There is no universally correct answer
 * (months vary 28-31 days, years 365-366, days 23-25 hours across a DST
 * transition), so this throws instead of guessing. Pass `relativeTo` (an
 * anchor date to measure against) or `{ daysAre24h: true }` (days only, never
 * months/years) to resolve it explicitly.
 */
export class AmbiguousDurationError extends DurationError {}
