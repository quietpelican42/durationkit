// Regenerates test/fixtures/go-parse.json and go-format.json by differential
// testing against the real Go standard library.
//
// Requires a local Go toolchain (`go run`); not needed to run the test suite,
// only to regenerate the fixtures it reads.
//
//   node test/fixtures/generators/generate-go-fixtures.mjs
//
// Generates random Go-style duration strings (valid and invalid shapes), feeds
// them through the real `time.ParseDuration` via goprobe/parse, and writes a
// JSON fixture file of {input, ok, ns} for differential testing.
//
// Also generates random int64 nanosecond counts, feeds them through
// goprobe/format (time.Duration.String()), and writes a fixture of
// {ns, expected}.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

const N_PARSE = 20000;
const N_FORMAT = 20000;

function rngSeed(seed) {
  let s = seed >>> 0;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}
const rand = rngSeed(20260929);

const UNITS = ['ns', 'us', 'µs', 'μs', 'ms', 's', 'm', 'h'];

function randInt(n) {
  return Math.floor(rand() * n);
}

function randDigits(maxLen) {
  const len = 1 + randInt(maxLen);
  let s = '';
  for (let i = 0; i < len; i++) s += randInt(10);
  return s;
}

function randComponent() {
  // number [ '.' fraction ] unit
  let s = randDigits(6);
  if (rand() < 0.4) s += '.' + randDigits(6);
  s += UNITS[randInt(UNITS.length)];
  return s;
}

function randValidCompound() {
  const n = 1 + randInt(4);
  let s = '';
  for (let i = 0; i < n; i++) s += randComponent();
  if (rand() < 0.3) s = (rand() < 0.5 ? '-' : '+') + s;
  return s;
}

function randGarbageString() {
  const chars = '0123456789.hmsuµnµ-+ xX_e';
  const len = randInt(12);
  let s = '';
  for (let i = 0; i < len; i++) s += chars[randInt(chars.length)];
  return s;
}

const EDGE_CASES = [
  '', '0', '-0', '+0', '1', '-1', 'h', '1hh', '.s', '1.s', '.1s', '1h1h',
  '1h1h1h', '1..5h', '1.5.5h', '-', '+', '--1h', '1h-30m', '9223372036854775807ns',
  '9223372036854775808ns', '-9223372036854775808ns', '-9223372036854775809ns',
  '1e10h', '1E10h', 'NaNh', 'Infinityh', '1µs', '1us', '1μs', '  1h', '1h  ',
  '1H', '1M', '1S', '1Ms', '1hns', 'h1', '1h30m0s', '0h0m0s', '2562047h47m16.854775807s',
  '2562047h47m16.854775808s', '-2562047h47m16.854775808s', '0.0000000001h',
  '1.5h', '1.5m', '1.5s', '1.5ms', '1.5us', '1.5ns', '18446744073709551616ns',
  '99999999999999999999h', '1.', '1.0', '.', '1_000h', '\t1h',
];

const inputs = new Set(EDGE_CASES);
while (inputs.size < N_PARSE) {
  const r = rand();
  if (r < 0.55) inputs.add(randValidCompound());
  else if (r < 0.8) inputs.add(randGarbageString());
  else inputs.add(randComponent());
}
// Stdin is scanned line-by-line, so an input containing '\n' would desync every
// fixture after it from the probe's output; guard against that unconditionally.
const parseInputs = Array.from(inputs).filter((s) => !s.includes('\n') && !s.includes('\r'));

const parseProbe = spawnSync('go', ['run', './parse'], {
  cwd: new URL('./goprobe', import.meta.url).pathname,
  input: parseInputs.join('\n') + '\n',
  encoding: 'utf8',
  maxBuffer: 1024 * 1024 * 64,
});
if (parseProbe.status !== 0) {
  console.error(parseProbe.stderr);
  process.exit(1);
}
const parseLines = parseProbe.stdout.split('\n');
const parseFixtures = [];
for (let i = 0; i < parseInputs.length; i++) {
  const line = parseLines[i];
  if (line === undefined) continue;
  if (line === 'ERR') {
    parseFixtures.push({ input: parseInputs[i], ok: false });
  } else {
    const [, ns] = line.split('\t');
    parseFixtures.push({ input: parseInputs[i], ok: true, ns });
  }
}

// --- format fixtures: random int64 ns values ---
function randBigIntRange() {
  const MAXI64 = 9223372036854775807n;
  const MINI64 = -9223372036854775808n;
  const r = rand();
  if (r < 0.02) return MAXI64;
  if (r < 0.04) return MINI64;
  if (r < 0.06) return 0n;
  if (r < 0.1) return BigInt(randInt(1000)) * (rand() < 0.5 ? -1n : 1n);
  // random magnitude bits
  const bits = 1 + randInt(63);
  let v = 0n;
  for (let i = 0; i < bits; i++) v = (v << 1n) | BigInt(randInt(2));
  if (rand() < 0.5) v = -v;
  if (v > MAXI64) v = MAXI64;
  if (v < MINI64) v = MINI64;
  return v;
}

const formatSet = new Set([
  '0', '1', '-1', '999', '1000', '999999999', '1000000000', '1000000001',
  '59999999999', '60000000000', '3599999999999', '3600000000000',
  '9223372036854775807', '-9223372036854775808', '-1', '-999',
]);
while (formatSet.size < N_FORMAT) formatSet.add(randBigIntRange().toString());
const formatInputs = Array.from(formatSet);

const formatProbe = spawnSync('go', ['run', './format'], {
  cwd: new URL('./goprobe', import.meta.url).pathname,
  input: formatInputs.join('\n') + '\n',
  encoding: 'utf8',
  maxBuffer: 1024 * 1024 * 64,
});
if (formatProbe.status !== 0) {
  console.error(formatProbe.stderr);
  process.exit(1);
}
const formatLines = formatProbe.stdout.split('\n');
const formatFixtures = [];
for (let i = 0; i < formatInputs.length; i++) {
  const line = formatLines[i];
  if (line === undefined || line === '') continue;
  formatFixtures.push({ ns: formatInputs[i], expected: line });
}

fs.writeFileSync(
  new URL('../go-parse.json', import.meta.url),
  JSON.stringify(parseFixtures),
);
fs.writeFileSync(
  new URL('../go-format.json', import.meta.url),
  JSON.stringify(formatFixtures),
);

console.log('parse fixtures:', parseFixtures.length, 'format fixtures:', formatFixtures.length);
