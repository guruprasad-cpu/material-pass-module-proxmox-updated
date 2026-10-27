# Material Pass Module

Single-project Material Pass application using Vue 3, Express 5, SQLite, PDFKit, QRCode, session login, and bcrypt password hashing.

## Run on Windows
1. Back up your existing `material.db` before replacing project files.
2. Install Node.js 20+ (Node 24 is also supported with the pinned Vite 6 stack).
3. Open Command Prompt in this project folder.
4. Run `npm install`
5. Run `npm run build`
6. Run `npm start`
7. Open http://localhost:3000

First login: `admin` / `Admin@123`. Create a new admin account, test it, and then remove the default account. Change the session secret using the `SESSION_SECRET` environment variable before production use. Use HTTPS and regular database backups for real deployment.

## Roles
- **Admin:** approve/reject pending passes, manage user accounts, and manage duty approvers/signatures.
- **User:** create passes and record arrival/return operations.

## Duty-person approval
Pass creation is record-only and does not require approval. The User records actual arrival quantities; the pass then moves to **Pending Arrival Approval** for the individual Approver. For returnable items, after arrival approval the User records return/exit quantities, and the record moves to **Pending Return Approval**. The Approver can approve or reject each arrival/return record; rejected records can be corrected and resubmitted.

## Excel report
Use **Download Excel Report** on the Dashboard. The report follows the current date and search filters and downloads an Excel-compatible `.xls` workbook. It includes one row per material line, pass/contractor information, quantities, status, approval/rejection information, and IT asset fields.

## Notes
- The dashboard search filters and Excel report share the same filter fields.
- The QR code contains structured pass and item data when it fits; very large payloads use a scan-page fallback.
- This starter application should receive a security review and workflow testing before use in a production or security-sensitive environment.


## Login, company-specific users, and password visibility

- The login screen has a Show/Hide password control. The admin account manager has the same control when creating a user.
- User usernames are matched case-insensitively and surrounding spaces are ignored. Existing bcrypt password hashes continue to work; a legacy plain-text password is upgraded to bcrypt after a successful login.
- When creating a User account, Admin must enter the exact Company / Contractor name. That user sees only passes for the assigned company in the dashboard, pass list, pass detail and PDF, and Excel export. The server enforces this restriction; it is not just a UI filter.
- Existing user accounts from an earlier version may not have a company assigned. Sign in as Admin, open Manage Accounts, and choose Set Company for each such account. The user should log out and sign in again after assignment.
- Admin accounts can see all companies.

After replacing the project files, back up `material.db`, then run `npm install`, `npm run build`, and `npm start`.

## Dashboard data troubleshooting
The dashboard now loads all dates by default. Use From date and To date to narrow the results to a specific day or period.

Important: SQLite data is stored in `material.db` in this project folder. If you extracted this update into a new folder, stop the application and copy your existing `material.db` from the previous working project folder into this folder before starting the server. Do not replace your existing database with a new/empty database. Keep a separate backup before copying.

## Docker on Linux / Proxmox
See `DOCKER-README.md`. Quick start: `docker compose up -d --build`. Persistent database: `data/material.db`.


## Updated roles and approval flow

- **Admin**: creates accounts, reviews passes that have been reviewed by an Approver, and gives the final approval or rejects with a required remark. Admin accounts do not create passes or record arrivals/returns in the interface.
- **User**: creates passes for the assigned company and contract, records arrival quantities, and records return quantities. User accounts can only access passes for their assigned company and contract.
- **Approver**: has an individual account and display name (for example, RPO/LPM), reviews a pass, and can record arrival/return operations. The approver review is saved on the pass and printed on the PDF without a signature image. Admin then provides final approval.

The account form shows company and contract fields for User accounts, and an approver-name field for Approver accounts. The old Duty Approvers interface is removed. Directions are stored as **IN** and **OUT**. Returnable pass status is red when the due date has passed and quantities remain outstanding, yellow while quantities remain pending before the due date, and green when the return is complete. For Non-Returnable passes with direction OUT, an officer-authority reference is mandatory. PDF quantity columns use red for Pass Qty, yellow for Arrived Qty, and green for Returned Qty. Unentered optional details are left blank on the PDF for manual completion.

## Node.js runtime

The Docker build and runtime stages use Node.js 24 (`node:24-bookworm-slim`). `package.json` declares Node.js `>=24 <25`.
