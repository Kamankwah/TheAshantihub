# Task 6 report
Implemented per brief: OwnerListingCard server chips (catalogueOn gate, Low-stock line toggle mounting StockLineEditor on open), ProductsPanel pills (Your products | Needs restocking (n)), RestockSummaryCard, AnalyticsPanel/BusinessCommandCenter wiring (selectTab view, keyed ProductsPanel), one BusinessDashboard.test.jsx edit (stock handler only).
Note: the count chip's untracked text changed from "Stock not tracked" to "Stock not counted" (brief copy); no test asserted the old text.
RED: new tests failed (missing RestockSummaryCard module; no Low stock/Sold out/line button).
GREEN: `npx vitest run components/dashboard components/catalogue BusinessDashboard.test.jsx` 31 files / 313 tests passed.
Full suite: 359 passed files, 2 failed (AdminCommandCenter fraud-link-gate, OpsTargetsPanel) - unrelated; both pass alone (32/32) and also with my changes stashed. Under load they hit MSW unhandled /api/support/staff/people/recent etc. (pre-existing flakiness).

## Fix round 1
Replaced the two hardcoded `#1a1205` literals my diff added (RestockSummaryCard.jsx button, ProductsPanel.jsx pill) with `D.darkBrown`. No other hex literals in the 4623814b diff.
Command: `cd frontend && npx vitest run components/catalogue components/dashboard __tests__/darkModeLiterals.test.js`
Output: Test Files 31 passed (31), Tests 268 passed (268).
