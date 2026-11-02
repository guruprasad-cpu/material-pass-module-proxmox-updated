# Client Follow-up Changes

## PDF signature boxes
- The Contractor, Engineer and PIMT signature boxes are included only in the PDF opened immediately after a newly created pass is submitted.
- PDFs opened later from the pass list or dashboard use the workflow PDF and do not include the signature boxes.
- Editing an existing pass does not trigger the creation-only signature layout.

## Quantity columns
- New pass PDF and View: Quantity only (no Arrived, Returned or Pending Quantity columns).
- After an arrival transaction is recorded: Quantity and Arrived columns.
- After a return transaction is started: Quantity, Arrived, Returned and Pending Quantity columns.
- The same stage-based column rules are used in the PDF and the View dialog.

## Login page
- Removed the displayed default administrator username/password hint from the login page. The server-side initial account behaviour has not been changed.

## Pass number format
- New pass numbers use `MP-YEAR-CONTRACTOR-NNN`, where the contractor segment is taken from the Company Name field, converted to uppercase, and spaces/special separators are normalized to hyphens.
- Example: Company Name `MWC-04` produces `MP-2026-MWC-04-001` for the first pass for that contractor in that year.
- The next number is calculated separately for each contractor and year, using the highest existing numeric suffix.

## Validation note
- `node --check server.js` passed.
- A full Vite production build could not be run in this environment because npm dependencies were not available to complete installation. Please run `npm install` and `npm run build` in your deployment/test environment before production rollout.
- Back up the live SQLite database and test this package in a staging container before replacing the live application.
