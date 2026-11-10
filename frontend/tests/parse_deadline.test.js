import assert from 'node:assert/strict';
import { parseDeadline } from '../src/utils/parseDeadline.js';

const cases = [
  ['UTC MySQL datetime', '2026-11-10 12:30:45', Date.UTC(2026, 10, 10, 12, 30, 45)],
  ['UTC ISO without timezone', '2026-11-10T12:30:45', Date.UTC(2026, 10, 10, 12, 30, 45)],
  ['MySQL fractional seconds', '2026-11-10 12:30:45.987654', Date.UTC(2026, 10, 10, 12, 30, 45, 987)],
  ['UTC Z timestamp', '2026-11-10T12:30:45Z', Date.UTC(2026, 10, 10, 12, 30, 45)],
  ['Explicit positive offset', '2026-11-10T17:30:45+05:00', Date.UTC(2026, 10, 10, 12, 30, 45)],
  ['Explicit negative offset', '2026-11-10T07:30:45-05:00', Date.UTC(2026, 10, 10, 12, 30, 45)],
  ['Numeric epoch milliseconds', 1794313845000, 1794313845000],
  ['Date object', new Date(Date.UTC(2026, 10, 10, 12, 30, 45)), Date.UTC(2026, 10, 10, 12, 30, 45)]
];
for (const [name, input, expected] of cases) {
  assert.equal(parseDeadline(input), expected, name);
  console.log('PASS:', name);
}
for (const [name, input] of [
  ['Empty deadline', ''],
  ['Null deadline', null],
  ['Invalid date', '2026-02-30 12:00:00'],
  ['Invalid hour', '2026-11-10 25:00:00'],
  ['Malformed string', 'not-a-date'],
  ['Unsupported object', {}]
]) {
  assert.ok(Number.isNaN(parseDeadline(input)), name);
  console.log('PASS:', name);
}
console.log('B6 DEADLINE PARSER: 14/14 PASS');
