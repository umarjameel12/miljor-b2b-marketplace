'use strict';
// B6-N/Q SOURCE GATE: seven pre-existing, isolated adapter suites.
// This runner is NOT a substitute for MySQL/HTTP/Safepay/browser integration.
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const suites = Object.freeze([
  ['b6_collective_recurring_policy_gate.js', 14],
  ['b6_collective_recurring_worker_gate.js', 8],
  ['b6_delivery_group_policy_gate.js', 16],
  ['b6_preorder_notification_policy_gate.js', 12],
  ['b6_collective_cycle_join_gate.js', 11],
  ['b6_collective_join_cutoff_gate.js', 9],
  ['b6_paid_delivery_acceptance_gate.js', 11]
]);

let successful = 0;
let failed = 0;
for (const [file, expectedAssertions] of suites) {
  const result = spawnSync(process.execPath, [path.join(__dirname, file)], {
    cwd: path.resolve(__dirname, '..'),
    env: { ...process.env, NODE_ENV: 'test' },
    stdio: 'inherit',
    timeout: 120000
  });
  if (result.error || result.status !== 0 || result.signal) {
    failed++;
    console.error('FAIL:', file, 'exit:', result.status, 'signal:', result.signal, result.error?.message || '');
  } else {
    successful += expectedAssertions;
    console.log('PASS source suite:', file, '(expected assertions:', expectedAssertions + ')');
  }
}
if (failed) {
  console.error('B6-N/Q isolated source gate FAILED:', failed, 'suite(s).');
  process.exitCode = 1;
} else {
  console.log('B6-N/Q isolated source gate: 7/7 suites EXIT 0; expected suite assertions 81.');
  console.log('Not a real DB/API/browser/payment acceptance verdict.');
}
