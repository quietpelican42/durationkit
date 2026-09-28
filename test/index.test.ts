import assert from 'node:assert/strict';
import { test, describe } from 'node:test';

import { parse, format, GoDurationError, IsoDurationError } from '../src/index.ts';

describe('parse — auto-detects the grammar', () => {
  test('a leading P (optionally signed) is treated as ISO 8601', () => {
    const a = parse('P1DT2H');
    assert.equal(a.grammar, 'iso');
    if (a.grammar === 'iso') assert.equal(a.days, 1);

    const b = parse('-P1D');
    assert.equal(b.grammar, 'iso');
    if (b.grammar === 'iso') assert.equal(b.days, -1);
  });

  test('anything else is treated as Go-style', () => {
    const a = parse('1h30m');
    assert.equal(a.grammar, 'go');
    if (a.grammar === 'go') assert.equal(a.ns, 5_400_000_000_000n);

    const b = parse('-1.5s');
    assert.equal(b.grammar, 'go');
    if (b.grammar === 'go') assert.equal(b.ns, -1_500_000_000n);
  });

  test('each branch throws its own error type, not a generic one', () => {
    assert.throws(() => parse('1hh'), GoDurationError);
    assert.throws(() => parse('P'), IsoDurationError);
  });
});

describe('format — the inverse of parse, dispatched by .grammar', () => {
  test('go-style round-trips to its canonical spelling', () => {
    const parsed = parse('1h30m');
    assert.equal(format(parsed), '1h30m0s');
  });

  test('ISO 8601 round-trips exactly', () => {
    const parsed = parse('P1DT2H');
    assert.equal(format(parsed), 'P1DT2H');
  });
});
