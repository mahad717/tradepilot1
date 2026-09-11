// DST sanity checks for sessionKeyAt
import { sessionKeyAt } from "../src/lib/ict/sessions";
const cases: [string, number, string][] = [
  // (label, UTC time, expected)
  ["London KZ summer (BST): 2026-07-15 07:30 UTC = 08:30 London", Date.UTC(2026, 6, 15, 7, 30), "london"],
  ["London KZ winter (GMT): 2026-01-15 07:30 UTC = 07:30 London", Date.UTC(2026, 0, 15, 7, 30), "london"],
  ["London just before KZ summer: 2026-07-15 05:50 UTC = 06:50 London", Date.UTC(2026, 6, 15, 5, 50), "asia"],
  ["NY AM summer: 2026-07-15 14:00 UTC = 10:00 New York", Date.UTC(2026, 6, 15, 14, 0), "ny-am"],
  ["NY AM winter: 2026-01-15 15:00 UTC = 10:00 New York", Date.UTC(2026, 0, 15, 15, 0), "ny-am"],
  ["NY AM just before open: 2026-07-15 13:20 UTC = 09:20 New York", Date.UTC(2026, 6, 15, 13, 20), "off-session"],
  ["Asia: 2026-07-15 02:00 UTC", Date.UTC(2026, 6, 15, 2, 0), "asia"],
  ["NY PM summer: 2026-07-15 18:00 UTC = 14:00 New York", Date.UTC(2026, 6, 15, 18, 0), "ny-pm"],
];
let pass = 0;
for (const [label, t, expected] of cases) {
  const got = sessionKeyAt(t / 1000);
  const ok = got === expected;
  if (ok) pass++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label} → ${got}`);
}
console.log(`${pass}/${cases.length} DST checks pass`);
