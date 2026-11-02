# AttendX 0.4.0 — Lecturer Accounts + Location-Verified Attendance

AttendX uses a React + Vite frontend and a Node.js + Express API with SQLite persistence and ExcelJS exports. Lecturer and student portals have separate interfaces. Lecturer management routes require a lecturer account; student access uses the fixed 10-minute section-code login.

## Requirements
- Node.js 20.19+ and npm
- A browser with geolocation support
- HTTPS for deployed use (`localhost` is allowed for local development)

## Run locally

Terminal 1 — backend:
```bash
cd backend
npm install
npm run dev
```
API health check: `http://localhost:8080/api/health`. SQLite is created automatically.

Terminal 2 — frontend:
```bash
cd frontend
npm install
npm run dev
```
Open the Vite URL, normally `http://localhost:5173`.

Optional frontend API URL: create `frontend/.env`:
```env
VITE_API_URL=http://localhost:8080/api
```

Before deployment, set a long random `ATTENDX_TOKEN_SECRET`, the exact `FRONTEND_ORIGIN`, and HTTPS. Never commit `.env` files or production secrets.

## Portals
- `/` — portal selection
- `/lecturer` — lecturer registration/login and lecturer dashboard
- `/student` — student login and location-verified check-in

## Lecturer accounts
- A lecturer registers with full name, email address and a password of at least 10 characters.
- Passwords are salted and hashed with Node.js `scrypt`; plaintext passwords are never stored.
- Login issues a signed lecturer token valid for seven days. The frontend keeps it in local storage for this prototype.
- Session creation, manual check-in, records, session closure and Excel export require that token and are restricted to the lecturer who owns the session.
- Each lecturer can have one active session at a time; different lecturers can run sessions concurrently.
- This is open self-registration, not university-verified staff onboarding. Before institutional deployment, add email verification or administrator approval and consider secure HttpOnly cookies instead of localStorage tokens.

## Lecturer GPS troubleshooting
The lecturer browser collects several high-accuracy GPS readings for up to 12 seconds and uses the best reading. Readings with reported uncertainty above 250 metres are rejected; the previous 100-metre lecturer threshold was too strict for many indoor/local testing conditions.

If GPS is still too imprecise:
1. In Windows, enable **Settings → Privacy & security → Location → Location services**.
2. Allow location access for the browser in Windows and in the browser site-permission settings.
3. Use Chrome or Edge and open AttendX through `http://localhost` during local development (not a LAN IP or plain HTTP remote host).
4. Move near an outside-facing window or outdoors, wait for the location reading, then retry.
5. A desktop without GPS hardware may rely on Wi-Fi/IP-based location and can remain too imprecise. A phone with location services enabled may provide a better reference.

A 250-metre accuracy acceptance ceiling is a practical prototype compromise, not a claim of 250-metre attendance precision. If the lecturer's reference fix is imprecise, distance verification is less reliable. For real deployments, use a surveyed/registered lecture-hall coordinate or a dedicated positioning method and review location accuracy alongside measured distance.

## Student flow and security rules
1. Student enters index/reference number and the active six-digit section code.
2. API validates the code against an open session and issues a signed token expiring exactly 10 minutes after login.
3. Refreshing the page restores the same token without extending its expiry. The UI has no manual logout control; the login ends at the original 10-minute deadline. The server rejects expired tokens.
4. Student enters full name and requests check-in. GPS is compared with the lecturer's saved session location.
5. Student check-in rejects invalid/inaccurate GPS (>100 metres reported uncertainty), out-of-radius location, duplicate index number, duplicate device key, closed session or expired token.
6. Successful check-in displays a congratulations confirmation and remains saved after login expiry.

## Attendance and exports
- Lecturer starts a session, displays its generated section code, monitors records and can manually mark students present.
- Student and lecturer-assisted records share one register.
- Excel export includes session details and attendance summary.

## API overview
- `GET /api/health`
- `POST /api/lecturer/register`
- `POST /api/lecturer/login`
- `GET /api/lecturer/me` (lecturer token required)
- `POST /api/sessions` (lecturer token required)
- `POST /api/student/login`
- `GET /api/student/me` (student token required)
- `POST /api/student/check-in` (student token required)
- `GET /api/sessions/:id/records` (owning lecturer token required)
- `POST /api/sessions/:id/manual` (owning lecturer token required)
- `POST /api/sessions/:id/close` (owning lecturer token required)
- `GET /api/sessions/:id/export` (owning lecturer token required)

## Prototype limitations
- Lecturer self-registration is not verified against a university staff directory. Add institutional email verification or admin approval before production.
- Student identity is not checked against an institutional roster. Index number and name are user-entered.
- Browser GPS can be inaccurate indoors and can be spoofed. It is a location signal, not cryptographic proof of physical presence.
- Device duplicate detection uses a browser-generated identifier. Clearing browser storage, private browsing or changing browsers/devices can bypass it. Browser JavaScript cannot provide strong hardware device attestation.
- Student location accuracy is currently limited to 100 metres; lecturer reference accuracy is accepted up to 250 metres. Tighten and calibrate these values after testing on the actual campus and devices.
- Section-code throttling is in-memory and per-process. Production needs shared rate limiting, audit logs, backups, security testing and monitoring.
- Existing attendance rows are preserved by the database migration. Sessions created before lecturer accounts existed have no owner account and therefore are not accessible through the new lecturer-protected session endpoints.
- Do not use this prototype as the sole basis for disciplinary decisions.
