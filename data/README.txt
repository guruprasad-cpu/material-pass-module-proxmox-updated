Persistent SQLite database folder.

The application database is material.db. On first start the server creates the schema; when an existing material.db is present, startup applies additive schema migrations and preserves existing pass/item/user records.

Database schema and table purpose: ../DATABASE-SCHEMA.md

Before updating an existing installation, stop the application and make a separate backup of material.db. Do not delete or replace the live database. Historical partial return transactions cannot be recreated if an older version stored only cumulative quantities.
