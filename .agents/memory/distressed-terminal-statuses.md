---
name: Distressed job terminal statuses
description: Python scraper engine uses "completed_no_results" for empty searches; frontends must treat it as terminal alongside "done"/"completed"/"failed".
---

## Rule
Any component polling a distressed-pipeline job MUST treat all of these as terminal (stop polling):
`"done"`, `"completed"`, `"failed"`, `"completed_no_results"`, `"partial_success"`

## Why
Phase C refactored the Python distressed pipeline to return `status: "completed_no_results"` when a county has no public-trustee/tax-assessor/etc data, instead of `"done"` with an empty result array. Before the fix, all three polling frontends (DistressedLeadGen.tsx, AiDistressed.tsx, Distressed.tsx in Tools) kept polling until the 2.5-minute timeout and showed "Search timed out" to the user.

## How to apply
- `scraperEngineClient.ts` — `JobStatus.status` union type includes all five values + exported `isJobTerminal()` helper.
- `DistressedLeadGen.tsx` (CRM) — `isTerminal` array check; shows user-friendly "No distressed listings found" message.
- `AiDistressed.tsx` (Tools) — `_isTerminal()` helper applied at all three poll-stop sites.
- `Distressed.tsx` (Tools) — `getStatusBadge()` renders a grey "No Results" badge with `<Info>` icon for `completed_no_results`.
