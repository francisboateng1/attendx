import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import Database from 'better-sqlite3';
import ExcelJS from 'exceljs';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const db = new Database(process.env.DB_FILE || path.join(here, '..', 'attendx.sqlite'));
db.pragma('journal_mode=WAL');
db.pragma('foreign_keys=ON');

db.exec(`
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  course_code TEXT NOT NULL,
  course_name TEXT NOT NULL,
  lecturer_name TEXT NOT NULL,
  section_code_hash TEXT NOT NULL,
  started_at TEXT NOT NULL,
  closes_at TEXT NOT NULL,
  closed_at TEXT,
  lecturer_latitude REAL,
  lecturer_longitude REAL,
  allowed_radius_m REAL NOT NULL DEFAULT 50,
  lecturer_id INTEGER
);
CREATE TABLE IF NOT EXISTS lecturers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  full_name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS attendance (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL REFERENCES sessions(id),
  student_name TEXT NOT NULL,
  index_number TEXT NOT NULL,
  checked_in_at TEXT NOT NULL,
  method TEXT NOT NULL CHECK(method IN ('STUDENT','LECTURER')),
  device_key_hash TEXT,
  UNIQUE(session_id,index_number)
);
CREATE UNIQUE INDEX IF NOT EXISTS one_device_per_session
  ON attendance(session_id,device_key_hash) WHERE device_key_hash IS NOT NULL;
`);

// Migrate databases created by AttendX 0.2.0 without deleting attendance history.
const sessionColumns = new Set(db.prepare('PRAGMA table_info(sessions)').all().map(c => c.name));
if (!sessionColumns.has('lecturer_latitude')) db.exec('ALTER TABLE sessions ADD COLUMN lecturer_latitude REAL');
if (!sessionColumns.has('lecturer_longitude')) db.exec('ALTER TABLE sessions ADD COLUMN lecturer_longitude REAL');
if (!sessionColumns.has('allowed_radius_m')) db.exec('ALTER TABLE sessions ADD COLUMN allowed_radius_m REAL NOT NULL DEFAULT 50');
if (!sessionColumns.has('lecturer_id')) db.exec('ALTER TABLE sessions ADD COLUMN lecturer_id INTEGER');

const app = express();
app.use(helmet());
app.use(cors({ origin: process.env.FRONTEND_ORIGIN?.split(',') || true }));
app.use(express.json({ limit: '32kb' }));
const clean = value => String(value ?? '').trim();
const now = () => new Date().toISOString();
const hash = value => crypto.createHash('sha256').update(String(value)).digest('hex');
const getSession = id => db.prepare('SELECT * FROM sessions WHERE id=?').get(id);
const isOpen = session => Boolean(session && !session.closed_at && Date.now() < Date.parse(session.closes_at));
const closeExpired = () => db.prepare('UPDATE sessions SET closed_at=closes_at WHERE closed_at IS NULL AND closes_at<=?').run(now());
const TOKEN_SECRET = process.env.ATTENDX_TOKEN_SECRET || 'development-only-change-this-secret-before-deployment';
if (!process.env.ATTENDX_TOKEN_SECRET) console.warn('WARNING: Set ATTENDX_TOKEN_SECRET to a long random secret before deployment.');
const STUDENT_LOGIN_MS = 10 * 60 * 1000;

function signStudentToken(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.createHmac('sha256', TOKEN_SECRET).update(body).digest('base64url');
  return `${body}.${signature}`;
}
function verifyStudentToken(token) {
  if (!token || typeof token !== 'string') return null;
  const [body, signature] = token.split('.');
  if (!body || !signature) return null;
  const expected = crypto.createHmac('sha256', TOKEN_SECRET).update(body).digest();
  let supplied;
  try { supplied = Buffer.from(signature, 'base64url'); } catch { return null; }
  if (expected.length !== supplied.length || !crypto.timingSafeEqual(expected, supplied)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!payload.exp || Date.now() >= payload.exp || !payload.sub) return null;
    return payload;
  } catch { return null; }
}
function signLecturerToken(payload) { return signStudentToken({ ...payload, role: 'lecturer' }); }
function verifyLecturerToken(token) {
  const payload = verifyStudentToken(token);
  return payload?.role === 'lecturer' && payload.sub ? payload : null;
}
function requireLecturer(req, res, next) {
  const token = clean(req.headers.authorization).replace(/^Bearer\s+/i, '');
  const payload = verifyLecturerToken(token);
  if (!payload) return res.status(401).json({ error: 'Please log in to your lecturer account.' });
  const lecturer = db.prepare('SELECT id,full_name AS fullName,email FROM lecturers WHERE id=?').get(payload.sub);
  if (!lecturer) return res.status(401).json({ error: 'Lecturer account was not found. Please log in again.' });
  req.lecturer = lecturer;
  next();
}
function requireOwnedSession(req, res) {
  const session = getSession(req.params.id);
  if (!session) { res.status(404).json({ error: 'Session not found.' }); return null; }
  if (session.lecturer_id !== req.lecturer.id) { res.status(403).json({ error: 'You do not have permission to access this attendance session.' }); return null; }
  return session;
}
function requireStudent(req, res, next) {
  const token = clean(req.headers.authorization).replace(/^Bearer\s+/i, '');
  const payload = verifyStudentToken(token);
  if (!payload || !payload.sid || payload.role === 'lecturer') return res.status(401).json({ error: 'Your 10-minute student login has expired. Please log in again.' });
  const session = getSession(payload.sid);
  if (!isOpen(session)) return res.status(401).json({ error: 'This attendance session is closed or has expired.' });
  req.studentAuth = payload;
  req.attendanceSession = session;
  next();
}
function validCoordinates(latitude, longitude) {
  return Number.isFinite(Number(latitude)) && Number.isFinite(Number(longitude)) &&
    Number(latitude) >= -90 && Number(latitude) <= 90 &&
    Number(longitude) >= -180 && Number(longitude) <= 180;
}
function distanceMetres(lat1, lon1, lat2, lon2) {
  const rad = value => value * Math.PI / 180;
  const dLat = rad(lat2 - lat1), dLon = rad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Lightweight in-memory throttling for guesses against six-digit section codes.
const loginAttempts = new Map();
function allowLoginAttempt(key) {
  const current = Date.now();
  const item = loginAttempts.get(key);
  if (!item || current - item.startedAt > 5 * 60 * 1000) {
    loginAttempts.set(key, { startedAt: current, count: 1 });
    return true;
  }
  item.count += 1;
  return item.count <= 12;
}

app.get('/api/health', (_req, res) => res.json({ status: 'ok', app: 'AttendX', version: '0.4.0' }));

// Lecturer account registration and login.
app.post('/api/lecturer/register', (req, res) => {
  const fullName = clean(req.body.fullName);
  const email = clean(req.body.email).toLowerCase();
  const password = String(req.body.password || '');
  if (fullName.length < 3 || fullName.length > 120) return res.status(400).json({ error: 'Enter your full name (3–120 characters).' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 190) return res.status(400).json({ error: 'Enter a valid email address.' });
  if (password.length < 10 || password.length > 200) return res.status(400).json({ error: 'Your password must contain at least 10 characters.' });
  const salt = crypto.randomBytes(16).toString('hex');
  const passwordHash = `${salt}:${crypto.scryptSync(password, salt, 64).toString('hex')}`;
  try {
    const result = db.prepare('INSERT INTO lecturers(full_name,email,password_hash,created_at) VALUES(?,?,?,?)').run(fullName, email, passwordHash, now());
    const lecturer = { id: Number(result.lastInsertRowid), fullName, email };
    const token = signLecturerToken({ sub: lecturer.id, iat: Date.now(), exp: Date.now() + 7 * 24 * 60 * 60 * 1000 });
    res.status(201).json({ token, lecturer });
  } catch (error) {
    if (String(error.code || '').startsWith('SQLITE_CONSTRAINT')) return res.status(409).json({ error: 'An account with this email address already exists. Please log in.' });
    throw error;
  }
});
app.post('/api/lecturer/login', (req, res) => {
  const email = clean(req.body.email).toLowerCase();
  const password = String(req.body.password || '');
  const row = db.prepare('SELECT id,full_name,email,password_hash FROM lecturers WHERE email=?').get(email);
  if (!row || !row.password_hash) return res.status(401).json({ error: 'Invalid email or password.' });
  const [salt, stored] = row.password_hash.split(':');
  const candidate = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(stored, 'hex');
  if (candidate.length !== expected.length || !crypto.timingSafeEqual(candidate, expected)) return res.status(401).json({ error: 'Invalid email or password.' });
  const lecturer = { id: row.id, fullName: row.full_name, email: row.email };
  const token = signLecturerToken({ sub: lecturer.id, iat: Date.now(), exp: Date.now() + 7 * 24 * 60 * 60 * 1000 });
  res.json({ token, lecturer });
});
app.get('/api/lecturer/me', requireLecturer, (req, res) => res.json({ lecturer: req.lecturer }));

// Lecturer starts a session and records the location that students must be near.
app.post('/api/sessions', requireLecturer, (req, res) => {
  const courseCode = clean(req.body.courseCode);
  const courseName = clean(req.body.courseName);
  const lecturerName = req.lecturer.fullName;
  const durationMinutes = Math.min(240, Math.max(1, Number(req.body.durationMinutes) || 20));
  const radius = Math.min(200, Math.max(10, Number(req.body.allowedRadiusM) || 50));
  const { latitude, longitude } = req.body;
  if (!courseCode || !courseName || !lecturerName) return res.status(400).json({ error: 'Course code, course name and lecturer name are required.' });
  if (!validCoordinates(latitude, longitude)) return res.status(400).json({ error: 'A valid lecturer GPS location is required to start attendance.' });
  if (!Number.isFinite(Number(req.body.locationAccuracy)) || Number(req.body.locationAccuracy) > 250) return res.status(400).json({ error: `GPS accuracy is currently ${Math.round(Number(req.body.locationAccuracy) || 0)} metres. Wait for a better GPS reading or move near a window/open area (maximum accepted uncertainty: 250 metres).` });
  closeExpired();
  if (db.prepare('SELECT id FROM sessions WHERE lecturer_id=? AND closed_at IS NULL AND closes_at>?').get(req.lecturer.id, now())) return res.status(409).json({ error: 'An attendance session is already active. Close it before starting another.' });
  let sectionCode;
  do {
    sectionCode = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
  } while (db.prepare('SELECT 1 FROM sessions WHERE section_code_hash=? AND closed_at IS NULL').get(hash(sectionCode)));
  const sessionId = crypto.randomUUID();
  const startedAt = now();
  const closesAt = new Date(Date.now() + durationMinutes * 60_000).toISOString();
  db.prepare(`INSERT INTO sessions
    (id,course_code,course_name,lecturer_name,section_code_hash,started_at,closes_at,closed_at,lecturer_latitude,lecturer_longitude,allowed_radius_m,lecturer_id)
    VALUES(?,?,?,?,?,?,?,NULL,?,?,?,?)`)
    .run(sessionId, courseCode, courseName, lecturerName, hash(sectionCode), startedAt, closesAt, Number(latitude), Number(longitude), radius, req.lecturer.id);
  res.status(201).json({ sessionId, courseCode, courseName, lecturerName, lecturerId: req.lecturer.id, sectionCode, startedAt, closesAt, allowedRadiusM: radius });
});

// Student login: the index number and active session code must match.
app.post('/api/student/login', (req, res) => {
  closeExpired();
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  const indexNumber = clean(req.body.indexNumber).toUpperCase();
  const sectionCode = clean(req.body.sectionCode);
  if (!indexNumber || !/^\d{6}$/.test(sectionCode)) return res.status(400).json({ error: 'Enter your index number and the six-digit section code.' });
  // Throttle per IP + index, not IP alone: an entire lecture hall may share one campus IP.
  if (!allowLoginAttempt(`${ip}:${indexNumber}`)) return res.status(429).json({ error: 'Too many login attempts for this index number. Wait five minutes and try again.' });
  const session = db.prepare('SELECT * FROM sessions WHERE section_code_hash=? ORDER BY started_at DESC LIMIT 1').get(hash(sectionCode));
  if (!isOpen(session) || session.lecturer_latitude == null || session.lecturer_longitude == null) return res.status(401).json({ error: 'The section code is incorrect, expired or attendance is not active.' });
  const exp = Date.now() + STUDENT_LOGIN_MS;
  const token = signStudentToken({ sid: session.id, sub: indexNumber, iat: Date.now(), exp });
  const existing = db.prepare('SELECT student_name AS studentName,index_number AS indexNumber,checked_in_at AS checkedInAt,method FROM attendance WHERE session_id=? AND index_number=?').get(session.id, indexNumber);
  res.json({ token, expiresAt: exp, student: { indexNumber }, session: { sessionId: session.id, courseCode: session.course_code, courseName: session.course_name, lecturerName: session.lecturer_name, closesAt: session.closes_at, allowedRadiusM: session.allowed_radius_m }, alreadyCheckedIn: Boolean(existing), attendance: existing || null });
});

// Restore a student portal after refresh without extending the original 10-minute expiry.
app.get('/api/student/me', requireStudent, (req, res) => {
  const { attendanceSession: session, studentAuth } = req;
  const existing = db.prepare('SELECT student_name AS studentName,index_number AS indexNumber,checked_in_at AS checkedInAt,method FROM attendance WHERE session_id=? AND index_number=?').get(session.id, studentAuth.sub);
  res.json({ expiresAt: studentAuth.exp, student: { indexNumber: studentAuth.sub }, session: { sessionId: session.id, courseCode: session.course_code, courseName: session.course_name, lecturerName: session.lecturer_name, closesAt: session.closes_at, allowedRadiusM: session.allowed_radius_m }, alreadyCheckedIn: Boolean(existing), attendance: existing || null });
});

// Student submits their name and current GPS position. Session/index are token-bound.
app.post('/api/student/check-in', requireStudent, (req, res) => {
  const session = req.attendanceSession;
  const indexNumber = req.studentAuth.sub;
  const studentName = clean(req.body.studentName);
  const deviceKey = clean(req.body.deviceKey);
  const { latitude, longitude, accuracy } = req.body.location || {};
  if (!studentName || studentName.length > 120 || !deviceKey) return res.status(400).json({ error: 'Enter your full name. A device identifier is also required.' });
  if (!validCoordinates(latitude, longitude)) return res.status(400).json({ error: 'Your current location could not be verified. Enable location permission and try again.' });
  if (!Number.isFinite(Number(accuracy)) || Number(accuracy) > 100) return res.status(400).json({ error: 'Your GPS accuracy is too low. Move to an open area and try again.' });
  const metres = distanceMetres(Number(session.lecturer_latitude), Number(session.lecturer_longitude), Number(latitude), Number(longitude));
  if (metres > session.allowed_radius_m) return res.status(403).json({ error: `You are approximately ${Math.round(metres)} metres from the lecturer. You must be within ${Math.round(session.allowed_radius_m)} metres to check in.` });
  const deviceHash = hash(deviceKey);
  if (db.prepare('SELECT 1 FROM attendance WHERE session_id=? AND index_number=?').get(session.id, indexNumber)) return res.status(409).json({ error: 'Your index number has already been recorded for this lecture.' });
  if (db.prepare('SELECT 1 FROM attendance WHERE session_id=? AND device_key_hash=?').get(session.id, deviceHash)) return res.status(409).json({ error: 'This device has already been used to check in another student for this lecture.' });
  const checkedInAt = now();
  try {
    db.prepare('INSERT INTO attendance(session_id,student_name,index_number,checked_in_at,method,device_key_hash) VALUES(?,?,?,?,?,?)')
      .run(session.id, studentName, indexNumber, checkedInAt, 'STUDENT', deviceHash);
  } catch (error) {
    if (String(error.code || '').startsWith('SQLITE_CONSTRAINT')) return res.status(409).json({ error: 'Duplicate attendance or device detected.' });
    throw error;
  }
  res.status(201).json({ message: 'Congratulations! Your attendance has been successfully recorded.', courseCode: session.course_code, courseName: session.course_name, indexNumber, studentName, checkedInAt, distanceMetres: Math.round(metres) });
});

// Lecturer-assisted check-in remains available for students without phones.
app.post('/api/sessions/:id/manual', requireLecturer, (req, res) => {
  const session = requireOwnedSession(req, res);
  if (!session) return;
  closeExpired();
  if (!isOpen(session)) return res.status(400).json({ error: 'Attendance is closed.' });
  const studentName = clean(req.body.studentName);
  const indexNumber = clean(req.body.indexNumber).toUpperCase();
  if (!studentName || !indexNumber) return res.status(400).json({ error: 'Student name and index/reference number are required.' });
  try {
    db.prepare('INSERT INTO attendance(session_id,student_name,index_number,checked_in_at,method) VALUES(?,?,?,?,?)').run(session.id, studentName, indexNumber, now(), 'LECTURER');
  } catch (error) {
    if (String(error.code || '').startsWith('SQLITE_CONSTRAINT')) return res.status(409).json({ error: 'This index/reference number is already on the attendance register.' });
    throw error;
  }
  res.status(201).json({ message: 'Student marked present by lecturer.' });
});

app.get('/api/sessions/:id/records', requireLecturer, (req, res) => {
  const session = requireOwnedSession(req, res);
  if (!session) return;
  closeExpired();
  res.json(db.prepare('SELECT student_name AS studentName,index_number AS indexNumber,checked_in_at AS checkedInAt,method FROM attendance WHERE session_id=? ORDER BY checked_in_at,id').all(session.id));
});

app.post('/api/sessions/:id/close', requireLecturer, (req, res) => {
  const session = requireOwnedSession(req, res);
  if (!session) return;
  db.prepare('UPDATE sessions SET closed_at=COALESCE(closed_at,?) WHERE id=?').run(now(), session.id);
  res.json({ message: 'Attendance session closed.' });
});

app.get('/api/sessions/:id/export', requireLecturer, async (req, res) => {
  const session = requireOwnedSession(req, res);
  if (!session) return;
  const rows = db.prepare('SELECT student_name AS studentName,index_number AS indexNumber,checked_in_at AS checkedInAt,method FROM attendance WHERE session_id=? ORDER BY student_name COLLATE NOCASE').all(session.id);
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'AttendX';
  const sheet = workbook.addWorksheet('Daily Attendance');
  sheet.addRows([['AttendX — Daily Attendance Register'], ['Course', `${session.course_code} — ${session.course_name}`], ['Lecturer', session.lecturer_name], ['Lecture date', new Date(session.started_at).toLocaleDateString('en-GB')], ['Session started', session.started_at], ['Attendance closed', session.closed_at || session.closes_at], [], ['No.','Student Name','Index/Reference Number','Check-in Time','Attendance Method']]);
  sheet.getRow(1).font = { bold: true, size: 16 };
  sheet.getRow(8).font = { bold: true };
  rows.forEach((row, index) => sheet.addRow([index + 1, row.studentName, row.indexNumber, new Date(row.checkedInAt).toLocaleTimeString('en-GB'), row.method === 'STUDENT' ? 'Student check-in' : 'Lecturer-verified']));
  sheet.columns = [{ width: 8 }, { width: 30 }, { width: 27 }, { width: 20 }, { width: 25 }];
  const summary = workbook.addWorksheet('Summary');
  const studentCheckIns = rows.filter(row => row.method === 'STUDENT').length;
  summary.addRows([['Attendance Summary'], ['Course', `${session.course_code} — ${session.course_name}`], ['Date', new Date(session.started_at).toLocaleDateString('en-GB')], ['Total present', rows.length], ['Student check-ins', studentCheckIns], ['Lecturer-verified', rows.length - studentCheckIns]]);
  summary.getRow(1).font = { bold: true, size: 16 };
  summary.columns = [{ width: 28 }, { width: 45 }];
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${session.course_code.replace(/[^a-z0-9]/gi, '')}_Attendance_${session.started_at.slice(0,10)}.xlsx"`);
  await workbook.xlsx.write(res);
  res.end();
});

app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(500).json({ error: 'Unexpected server error.' });
});
const PORT = Number(process.env.PORT || 8080);
app.listen(PORT, () => console.log(`AttendX JavaScript API listening on ${PORT}`));
