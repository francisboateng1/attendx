# AttendX 0.5.0 — TiDB backend migration notes

This backend replaces `better-sqlite3` with `mysql2/promise` and connects to TiDB Cloud using TLS.

## Files to replace in the existing repository
- `backend/src/server.js`
- `backend/package.json`

Also update the repository-root `render.yaml` if you intend to use Render Blueprint later. It is configured for a Free web service and has no persistent disk because attendance data is stored in TiDB.

## Required Render environment variables
- `TIDB_HOST`
- `TIDB_PORT` = `4000`
- `TIDB_USER`
- `TIDB_PASSWORD`
- `TIDB_DATABASE` = `attendx`
- `TIDB_ENABLE_SSL` = `true`
- `ATTENDX_TOKEN_SECRET` = a long random secret
- `FRONTEND_ORIGIN` = the exact deployed Vercel origin

Optional:
- `DB_CONNECTION_LIMIT` = `5`
- `TIDB_CA_PATH` = path to a CA file, only if your TiDB deployment requires a custom CA certificate.

## Create the database before starting the API
Run this in TiDB Cloud SQL Editor:

```sql
CREATE DATABASE attendx;
```

At startup, AttendX creates the `lecturers`, `sessions`, and `attendance` tables in that database.

## Local test environment
Create a local `backend/.env` file (do not commit it) with your actual TiDB connection values. For TiDB Cloud Starter public endpoints, TLS is required. The backend enables TLS by default unless `TIDB_ENABLE_SSL=false` is explicitly set.

## Verification limitation
The updated JavaScript passed `node --check`. Full integration tests against a live TiDB cluster have not yet been run. After setting the real TiDB credentials, start the API and verify `/api/health` returns `database: "connected"` before testing all attendance routes.

This release initializes a fresh TiDB schema. It does not automatically migrate records from any local SQLite database.
