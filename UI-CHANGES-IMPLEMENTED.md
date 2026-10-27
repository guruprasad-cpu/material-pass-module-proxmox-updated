# Material Pass Module – UI and transaction updates

## Included changes
- Pass listings use a column-wise table in each pass tab, with View and PDF links and a per-tab Excel download.
- New Returnable passes require Date of Return in the browser and server validation.
- Transport/escort/driver details are collected in the Record Arrival dialog rather than required during initial pass creation.
- Arrival and return quantity inputs default to full original quantity / remaining return balance, have a maximum value, and are validated in the browser and API.
- Record Arrival opens without the View dialog behind it.
- Arrival records awaiting approval can be edited using Edit Arrival. The existing transaction row is updated and an audit event is written.
- Pass details show Pending Quantity and return transaction history.
- PDF removes Final Approved By, Officer Authority, Rejected By and Rejection Remark; includes Pending Quantity and arrival/return transaction history; puts manual signature boxes and QR code at the end of the PDF.
- Pass editing is allowed before an arrival transaction has been created; it updates the existing pass and items and records an audit event.
- `hydrate()` returns arrival and return transaction history for the pass details and PDF.

## Database and deployment safety
- The project uses SQLite `material.db`; no live office database is included in this ZIP.
- Back up the live database before deployment.
- Test the update against a copy of the existing database first.
- Do not replace a populated `material.db` with a blank database.

## Validation performed
- `node --check server.js` passed.
- `database-schema.sql` executed successfully using Python's SQLite engine and created the expected application tables.
- A full Vite frontend build / application integration test could not be completed in this environment because dependency installation timed out. Run `npm install` and `npm run build` on the deployment/build machine before deploying.
