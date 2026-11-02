# AttendX 0.4.0 — Deployment Guide

## Recommended hosting layout
- Frontend: Vercel (Vite static deployment)
- Backend: Render Web Service
- Database: SQLite stored on a Render persistent disk mounted at `/var/data`

**Important:** The Render Blueprint uses the paid Starter web-service plan and a 1 GB persistent disk. Current listed pricing is approximately USD $7/month for Starter compute plus USD $0.25/month for 1 GB disk, before taxes/other usage. Confirm the amount shown in your Render dashboard before creating the service. Do not switch this backend to Render Free while using SQLite for real attendance: free services have ephemeral filesystems and cannot attach persistent disks, so attendance records can disappear after restarts/deploys.

## 1. Push the project to GitHub
1. Extract the ZIP.
2. Create a new GitHub repository named `attendx` (private is recommended).
3. Upload/push the contents of this folder to the repository root. The root must contain `render.yaml`, `backend/`, and `frontend/`.
4. Do not upload `.env` files, database files, passwords, or tokens. `.gitignore` excludes them.

## 2. Deploy the API on Render
1. Sign in to Render and choose **New → Blueprint**.
2. Connect the `attendx` GitHub repository.
3. Render reads `render.yaml`. Review the service configuration and the paid Starter + persistent disk cost before confirming.
4. When prompted for `FRONTEND_ORIGIN`, you can temporarily enter `http://localhost:5173`; after Vercel deployment, replace it with the exact Vercel production origin (for example `https://attendx-example.vercel.app`) and redeploy the API.
5. Wait for the service to become Live. Copy its `https://...onrender.com` URL.
6. Test `https://YOUR-API.onrender.com/api/health`. It should return JSON showing `status: "ok"` and version `0.4.0`.

The blueprint configures:
- `DB_FILE=/var/data/attendx.sqlite`
- A generated `ATTENDX_TOKEN_SECRET`
- A 1 GB persistent disk at `/var/data`
- `/api/health` as the health check

## 3. Deploy the frontend on Vercel
1. Sign in to Vercel and choose **Add New → Project**.
2. Import the same GitHub repository.
3. Set **Root Directory** to `frontend`.
4. Framework preset: **Vite**.
5. Build command: `npm run build`.
6. Output directory: `dist`.
7. Add Environment Variable:
   - Name: `VITE_API_URL`
   - Value: `https://YOUR-API.onrender.com/api`
8. Deploy and copy the Vercel production URL.

The included `frontend/vercel.json` supports direct refreshes on `/lecturer` and `/student`.

## 4. Connect Vercel to Render
1. In Render, open the `attendx-api` service → Environment.
2. Set `FRONTEND_ORIGIN` to the exact Vercel production origin, with no `/` or `/api` suffix (example: `https://attendx-example.vercel.app`).
3. Save and redeploy the API.
4. Open the Vercel site and test lecturer registration, login, session creation, student check-in, session records and Excel export.

## 5. Live deployment checklist
- [ ] `GET /api/health` returns status ok.
- [ ] `/lecturer` loads after direct navigation and refresh.
- [ ] Lecturer can register and log in.
- [ ] Lecturer can create and close a test session.
- [ ] Student can check in from a phone using HTTPS and location permission.
- [ ] Duplicate index number and duplicate device checks work.
- [ ] Excel export downloads.
- [ ] Create a test attendance record, redeploy/restart the API, and confirm the record remains. Do this before any real class.

## Important pilot limitations
- Lecturer self-registration is open and does not verify university employment. Do not present it as university-approved until staff approval/email verification is added.
- Browser GPS can be inaccurate or spoofed; it is not proof of physical presence. Test location accuracy around the actual lecture halls. The lecturer's reference location is currently collected from the browser, so a smartphone may be a better lecturer device than a laptop without GPS.
- Student names and index numbers are user-entered and not checked against a university roster.
- This is a controlled pilot prototype, not a sole source for disciplinary decisions. Arrange backups and review security before institutional use.
