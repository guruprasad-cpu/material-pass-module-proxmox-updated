# Client Observation Updates – 2 November 2026

Applied to this project package:

1. Added a white circular backing and subtle white outline to the Seabird logo in the navy application header so the dark logo remains visible.
2. For the initial pass-creation PDF, escort, driver and vehicle detail rows are omitted when the transport mode is By Vehicle. These details remain available in later workflow records.
3. Pass numbering now uses the contract name, not the company name: `MP-YEAR-CONTRACT-NNN`. The annual sequence is calculated separately for each contract.
4. Record Return opens with blank escort, driver and vehicle fields so the user can enter fresh return details.
5. Removed vehicle number and driver name from the Return Transaction History line in generated PDFs. The return history continues to show transaction status and approver/submission information.
6. Date of Return is visibly marked mandatory in the Returnable pass form. Client-side form validation and server-side validation both require a value.
7. Added an administrator-only Change Password action in Manage Accounts, backed by an admin-protected API endpoint. Passwords are stored as bcrypt hashes.

## Validation

- `node --check server.js` passed.
- The Vite production build could not be run in this environment because dependencies were not installed; `npm install` timed out and the Vite executable was unavailable. Run `npm install` and `npm run build` in the deployment/build environment before deploying.
