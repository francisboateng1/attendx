import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import mysql from 'mysql2/promise';
import ExcelJS from 'exceljs';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';

const requiredEnv = ['TIDB_HOST', 'TIDB_USER', 'TIDB_PASSWORD', 'TIDB_DATABASE', 'ATTENDX_TOKEN_SECRET'];
const missingEnv = requiredEnv.filter(key => !process.env[key]);
if (missingEnv.length) {
  console.error(`Missing required environment variables: ${missingEnv.join(', ')}`);
  process.exit(1);
}

const pool = mysql.createPool({
  host: process.env.TIDB_HOST,
  port: Number(process.env.TIDB_PORT || 4000),
  user: process.env.TIDB_USER,
  password: process.env.TIDB_PASSWORD,
  database: process.env.TIDB_DATABASE,
  ssl: process.env.TIDB_ENABLE_SSL === 'false' ? undefined : {
    minVersion: 'TLSv1.2',
    ...(process.env.TIDB_CA_PATH ? { ca: readFileSync(process.env.TIDB_CA_PATH) } : {})
  },
  waitForConnections: true,
  connectionLimit: Number(process.env.DB_CONNECTION_LIMIT || 5),
  queueLimit: 0,
  connectTimeout: 10000,
  charset: 'utf8mb4'
});

async function queryRows(sql, values = []) {
  const [rows] = await pool.execute(sql, values);
  return rows;
}
async function queryOne(sql, values = []) {
  const rows = await queryRows(sql, values);
  return rows[0] || null;
}
async function execute(sql, values = []) {
  const [result] = await pool.execute(sql, values);
  return result;
}



async function initializeDatabase() {

    // 1. Create lecturers table
    await pool.query(`
        CREATE TABLE IF NOT EXISTS lecturers (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            full_name VARCHAR(120) NOT NULL,
            email VARCHAR(190) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
            password_hash VARCHAR(180) NOT NULL,
            created_at VARCHAR(30) NOT NULL,
            PRIMARY KEY (id),
            UNIQUE KEY uq_lecturers_email (email)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // 2. Create sessions table
    await pool.query(`
        CREATE TABLE IF NOT EXISTS sessions (
            id VARCHAR(36) NOT NULL,
            course_code VARCHAR(40) NOT NULL,
            course_name VARCHAR(160) NOT NULL,
            lecturer_name VARCHAR(120) NOT NULL,
            section_code_hash CHAR(64) NOT NULL,
            started_at VARCHAR(30) NOT NULL,
            closes_at VARCHAR(30) NOT NULL,
            closed_at VARCHAR(30) NULL,
            lecturer_latitude DOUBLE NULL,
            lecturer_longitude DOUBLE NULL,
            lecturer_accuracy DOUBLE NULL,
            allowed_radius_m DOUBLE NOT NULL DEFAULT 50,
            lecturer_id BIGINT UNSIGNED NULL,
            PRIMARY KEY (id),
            KEY idx_sessions_lecturer_active (lecturer_id, closed_at, closes_at),
            KEY idx_sessions_section_hash (section_code_hash),
            KEY idx_sessions_started_at (started_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // 3. Check whether the lecturer_accuracy column exists.
    // This supports databases created with the older schema.
  const [accuracyColumns] = await pool.query(`
    SHOW COLUMNS FROM sessions LIKE 'lecturer_accuracy'
`);

if (accuracyColumns.length === 0) {
    await pool.query(`
        ALTER TABLE sessions
        ADD COLUMN lecturer_accuracy DOUBLE NULL
        AFTER lecturer_longitude
    `);
}

    // 4. Create attendance table
    await pool.query(`
        CREATE TABLE IF NOT EXISTS attendance (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            session_id VARCHAR(36) NOT NULL,
            student_name VARCHAR(120) NOT NULL,
            index_number VARCHAR(80) NOT NULL,
            checked_in_at VARCHAR(30) NOT NULL,
            method ENUM('STUDENT','LECTURER') NOT NULL,
            device_key_hash CHAR(64) NULL,
            PRIMARY KEY (id),
            UNIQUE KEY uq_attendance_session_index (session_id, index_number),
            UNIQUE KEY uq_attendance_session_device (session_id, device_key_hash),
            KEY idx_attendance_session_time (session_id, checked_in_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
}

const app = express();
app.set('trust proxy', 1);
app.use(helmet());
const allowedOrigins = process.env.FRONTEND_ORIGIN
  ? process.env.FRONTEND_ORIGIN.split(',').map(value => value.trim()).filter(Boolean)
  : [];
app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error('This origin is not allowed by AttendX CORS policy.'));
  }
}));
app.use(express.json({ limit: '32kb' }));

const clean = value => String(value ?? '').trim();
const now = () => new Date().toISOString();
const hash = value => crypto.createHash('sha256').update(String(value)).digest('hex');
const getSession = id => queryOne('SELECT * FROM sessions WHERE id=?', [id]);
const isOpen = session => Boolean(session && !session.closed_at && Date.now() < Date.parse(session.closes_at));
const closeExpired = () => execute('UPDATE sessions SET closed_at=closes_at WHERE closed_at IS NULL AND closes_at<=?', [now()]);
const TOKEN_SECRET = process.env.ATTENDX_TOKEN_SECRET;
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
async function requireLecturer(req, res, next) {
  try {
    const token = clean(req.headers.authorization).replace(/^Bearer\s+/i, '');
    const payload = verifyLecturerToken(token);
    if (!payload) return res.status(401).json({ error: 'Please log in to your lecturer account.' });
    const lecturer = await queryOne('SELECT id,full_name AS fullName,email FROM lecturers WHERE id=?', [payload.sub]);
    if (!lecturer) return res.status(401).json({ error: 'Lecturer account was not found. Please log in again.' });
    req.lecturer = lecturer;
    next();
  } catch (error) { next(error); }
}
async function requireOwnedSession(req, res) {
  const session = await getSession(req.params.id);
  if (!session) { res.status(404).json({ error: 'Session not found.' }); return null; }
  if (Number(session.lecturer_id) !== Number(req.lecturer.id)) {
    res.status(403).json({ error: 'You do not have permission to access this attendance session.' });
    return null;
  }
  return session;
}
async function requireStudent(req, res, next) {
  try {
    const token = clean(req.headers.authorization).replace(/^Bearer\s+/i, '');
    const payload = verifyStudentToken(token);
    if (!payload || !payload.sid || payload.role === 'lecturer') return res.status(401).json({ error: 'Your 10-minute student login has expired. Please log in again.' });
    const session = await getSession(payload.sid);
    if (!isOpen(session)) return res.status(401).json({ error: 'This attendance session is closed or has expired.' });
    req.studentAuth = payload;
    req.attendanceSession = session;
    next();
  } catch (error) { next(error); }
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
function isDuplicateError(error) { return error?.code === 'ER_DUP_ENTRY' || error?.errno === 1062; }

// Per-process throttling is a prototype safeguard; use shared rate limiting for production scale.
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

app.get('/api/health', async (_req, res, next) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', database: 'connected', app: 'AttendX', version: '0.5.0' });
  } catch (error) { next(error); }
});

app.post('/api/lecturer/register', async (req, res, next) => {
  try {
    const fullName = clean(req.body.fullName);
    const email = clean(req.body.email).toLowerCase();
    const password = String(req.body.password || '');
    if (fullName.length < 3 || fullName.length > 120) return res.status(400).json({ error: 'Enter your full name (3–120 characters).' });
   if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 190) {
    return res.status(400).json({
        error: 'Enter a valid email address.'
    });
}
    if (password.length < 10 || password.length > 200) return res.status(400).json({ error: 'Your password must contain at least 10 characters.' });
    const salt = crypto.randomBytes(16).toString('hex');
    const passwordHash = `${salt}:${crypto.scryptSync(password, salt, 64).toString('hex')}`;
    const result = await execute('INSERT INTO lecturers(full_name,email,password_hash,created_at) VALUES(?,?,?,?)', [fullName, email, passwordHash, now()]);
    const lecturer = { id: Number(result.insertId), fullName, email };
    const token = signLecturerToken({ sub: lecturer.id, iat: Date.now(), exp: Date.now() + 7 * 24 * 60 * 60 * 1000 });
    res.status(201).json({ token, lecturer });
  } catch (error) {
    if (isDuplicateError(error)) return res.status(409).json({ error: 'An account with this email address already exists. Please log in.' });
    next(error);
  }
});

app.post('/api/lecturer/login', async (req, res, next) => {
  try {
    const email = clean(req.body.email).toLowerCase();
    const password = String(req.body.password || '');
    const row = await queryOne('SELECT id,full_name,email,password_hash FROM lecturers WHERE email=?', [email]);
    if (!row || !row.password_hash) return res.status(401).json({ error: 'Invalid email or password.' });
    const [salt, stored] = row.password_hash.split(':');
    const candidate = crypto.scryptSync(password, salt, 64);
    const expected = Buffer.from(stored, 'hex');
    if (candidate.length !== expected.length || !crypto.timingSafeEqual(candidate, expected)) return res.status(401).json({ error: 'Invalid email or password.' });
    const lecturer = { id: Number(row.id), fullName: row.full_name, email: row.email };
    const token = signLecturerToken({ sub: lecturer.id, iat: Date.now(), exp: Date.now() + 7 * 24 * 60 * 60 * 1000 });
    res.json({ token, lecturer });
  } catch (error) { next(error); }
});
app.get('/api/lecturer/me', requireLecturer, (req, res) => res.json({ lecturer: req.lecturer }));

app.get('/api/lecturer/sessions', requireLecturer, async (req, res, next) => {
    try {

        await closeExpired();
        const sessions = await queryRows(`
            SELECT
                s.id AS sessionId,
                s.course_code AS courseCode,
                s.course_name AS courseName,
                s.lecturer_name AS lecturerName,
                s.started_at AS startedAt,
                s.closes_at AS closesAt,
                s.closed_at AS closedAt,
                s.allowed_radius_m AS allowedRadiusM,
                (
                    SELECT COUNT(*)
                    FROM attendance a
                    WHERE a.session_id = s.id
                ) AS attendanceCount
            FROM sessions s
            WHERE s.lecturer_id = ?
            ORDER BY s.started_at DESC
            LIMIT 100
        `, [req.lecturer.id]);

        res.json(sessions);
    } catch (error) {
        next(error);
    }
});


app.post('/api/sessions', requireLecturer, async (req, res, next) => {
  try {
    const courseCode = clean(req.body.courseCode);
    const courseName = clean(req.body.courseName);
    const lecturerName = req.lecturer.fullName;
    const durationMinutes = Math.min(240, Math.max(1, Number(req.body.durationMinutes) || 20));
    const radius = Math.min(200, Math.max(10, Number(req.body.allowedRadiusM) || 100));
    const { latitude, longitude } = req.body;
    if (!courseCode || !courseName || !lecturerName) return res.status(400).json({ error: 'Course code, course name and lecturer name are required.' });
    if (!validCoordinates(latitude, longitude)) return res.status(400).json({ error: 'A valid lecturer GPS location is required to start attendance.' });
  
    
    const lecturerAccuracy = Number(req.body.locationAccuracy);

if (
    !Number.isFinite(lecturerAccuracy) ||
    lecturerAccuracy <= 0 ||
    lecturerAccuracy > 50
) {
    return res.status(400).json({
        error: 'Your GPS accuracy is too low. Move to an open area and try again.'
    });
}

    await closeExpired();
    const active = await queryOne('SELECT id FROM sessions WHERE lecturer_id=? AND closed_at IS NULL AND closes_at>? LIMIT 1', [req.lecturer.id, now()]);
    if (active) return res.status(409).json({ error: 'An attendance session is already active. Close it before starting another.' });
    let sectionCode;
    do {
      sectionCode = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
    } while (await queryOne('SELECT 1 AS found FROM sessions WHERE section_code_hash=? AND closed_at IS NULL LIMIT 1', [hash(sectionCode)]));
    const sessionId = crypto.randomUUID();
    const startedAt = now();
    const closesAt = new Date(Date.now() + durationMinutes * 60_000).toISOString();
   await execute(`INSERT INTO sessions
  (
    id,
    course_code,
    course_name,
    lecturer_name,
    section_code_hash,
    started_at,
    closes_at,
    closed_at,
    lecturer_latitude,
    lecturer_longitude,
    lecturer_accuracy,
    allowed_radius_m,
    lecturer_id
  )
  VALUES(?,?,?,?,?,?,?,NULL,?,?,?,?,?)`,
[
    sessionId,
    courseCode,
    courseName,
    lecturerName,
    hash(sectionCode),
    startedAt,
    closesAt,
    Number(latitude),
    Number(longitude),
    lecturerAccuracy,
    radius,
    req.lecturer.id
]);
    res.status(201).json({ sessionId, courseCode, courseName, lecturerName, lecturerId: req.lecturer.id, sectionCode, startedAt, closesAt, allowedRadiusM: radius });
  } catch (error) { next(error); }
});

app.post('/api/student/login', async (req, res, next) => {
  try {
    await closeExpired();
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const indexNumber = clean(req.body.indexNumber).toUpperCase();
    const sectionCode = clean(req.body.sectionCode);
    if (!indexNumber || !/^\d{6}$/.test(sectionCode)) return res.status(400).json({ error: 'Enter your index number and the six-digit section code.' });
    if (!allowLoginAttempt(`${ip}:${indexNumber}`)) return res.status(429).json({ error: 'Too many login attempts for this index number. Wait five minutes and try again.' });
    const session = await queryOne('SELECT * FROM sessions WHERE section_code_hash=? ORDER BY started_at DESC LIMIT 1', [hash(sectionCode)]);
    if (!isOpen(session) || session.lecturer_latitude == null || session.lecturer_longitude == null) return res.status(401).json({ error: 'The section code is incorrect, expired or attendance is not active.' });
    const exp = Date.now() + STUDENT_LOGIN_MS;
    const token = signStudentToken({ sid: session.id, sub: indexNumber, iat: Date.now(), exp });
    const existing = await queryOne('SELECT student_name AS studentName,index_number AS indexNumber,checked_in_at AS checkedInAt,method FROM attendance WHERE session_id=? AND index_number=?', [session.id, indexNumber]);
    res.json({ token, expiresAt: exp, student: { indexNumber }, session: { sessionId: session.id, courseCode: session.course_code, courseName: session.course_name, lecturerName: session.lecturer_name, closesAt: session.closes_at, allowedRadiusM: Number(session.allowed_radius_m) }, alreadyCheckedIn: Boolean(existing), attendance: existing || null });
  } catch (error) { next(error); }
});

app.get('/api/student/me', requireStudent, async (req, res, next) => {
  try {
    const { attendanceSession: session, studentAuth } = req;
    const existing = await queryOne('SELECT student_name AS studentName,index_number AS indexNumber,checked_in_at AS checkedInAt,method FROM attendance WHERE session_id=? AND index_number=?', [session.id, studentAuth.sub]);
    res.json({ expiresAt: studentAuth.exp, student: { indexNumber: studentAuth.sub }, session: { sessionId: session.id, courseCode: session.course_code, courseName: session.course_name, lecturerName: session.lecturer_name, closesAt: session.closes_at, allowedRadiusM: Number(session.allowed_radius_m) }, alreadyCheckedIn: Boolean(existing), attendance: existing || null });
  } catch (error) { next(error); }
});

app.post('/api/student/check-in', requireStudent, async (req, res, next) => {
  try {
    const session = req.attendanceSession;
    const indexNumber = req.studentAuth.sub;
    const studentName = clean(req.body.studentName);
    const deviceKey = clean(req.body.deviceKey);
    const { latitude, longitude, accuracy } = req.body.location || {};
    if (!studentName || studentName.length > 120 || !deviceKey) return res.status(400).json({ error: 'Enter your full name. A device identifier is also required.' });
    if (!validCoordinates(latitude, longitude)) return res.status(400).json({ error: 'Your current location could not be verified. Enable location permission and try again.' });


  const lecturerAccuracy = Number(session.lecturer_accuracy);
const studentAccuracy = Number(accuracy);
if (
    !Number.isFinite(studentAccuracy) ||
    studentAccuracy <= 0 ||
    studentAccuracy > 100
) {
    return res.status(400).json({
        error: 'Your GPS accuracy is too low. Move to an open area and try again.'
    });
}


if (
    !Number.isFinite(lecturerAccuracy) ||
    lecturerAccuracy <= 0 ||
    lecturerAccuracy > 50
) {
    return res.status(400).json({
        error: 'Your GPS accuracy is too low. Move to an open area and try again.'
    });
}
const metres = distanceMetres(
    Number(session.lecturer_latitude),
    Number(session.lecturer_longitude),
    Number(latitude),
    Number(longitude)
);

const radius = Number(session.allowed_radius_m);

// Approximate combined GPS uncertainty.
const uncertainty = Math.sqrt(
    lecturerAccuracy ** 2 +
    studentAccuracy ** 2
);

console.log('GPS VERIFICATION:', {
    distance: metres,
    lecturerAccuracy,
    studentAccuracy,
    allowedRadius: radius,
    combinedUncertainty: uncertainty
});


// Reject only when the measured distance is clearly outside
// the permitted radius, even after accounting for uncertainty.
if (metres - uncertainty > radius) {
    return res.status(403).json({
        error: `Your location appears to be approximately ${Math.round(metres)} metres from the lecturer, outside the permitted ${Math.round(radius)}-metre radius.`
    });
}

// If the uncertainty overlaps the boundary, request better readings.
// Do not automatically accept or reject this check-in.
if (metres + uncertainty > radius) {
    return res.status(409).json({
        error: 'Your GPS location is too uncertain to verify your distance. Move to an open area and try again.'
    });
}
    const deviceHash = hash(deviceKey);
    const checkedInAt = now();
    try {
      await execute('INSERT INTO attendance(session_id,student_name,index_number,checked_in_at,method,device_key_hash) VALUES(?,?,?,?,?,?)', [session.id, studentName, indexNumber, checkedInAt, 'STUDENT', deviceHash]);
    } catch (error) {
      if (isDuplicateError(error)) {
        const indexExists = await queryOne('SELECT id FROM attendance WHERE session_id=? AND index_number=? LIMIT 1', [session.id, indexNumber]);
        if (indexExists) return res.status(409).json({ error: 'Your index number has already been recorded for this lecture.' });
        return res.status(409).json({ error: 'This device has already been used to check in another student for this lecture.' });
      }
      throw error;
    }
    res.status(201).json({ message: 'Congratulations! Your attendance has been successfully recorded.', courseCode: session.course_code, courseName: session.course_name, indexNumber, studentName, checkedInAt, distanceMetres: Math.round(metres) });
  } catch (error) { next(error); }
});

app.post('/api/sessions/:id/manual', requireLecturer, async (req, res, next) => {
  try {
    const session = await requireOwnedSession(req, res);
    if (!session) return;
    await closeExpired();
    if (!isOpen(session)) return res.status(400).json({ error: 'Attendance is closed.' });
    const studentName = clean(req.body.studentName);
    const indexNumber = clean(req.body.indexNumber).toUpperCase();
    if (!studentName || !indexNumber) return res.status(400).json({ error: 'Student name and index/reference number are required.' });
    try {
      await execute('INSERT INTO attendance(session_id,student_name,index_number,checked_in_at,method) VALUES(?,?,?,?,?)', [session.id, studentName, indexNumber, now(), 'LECTURER']);
    } catch (error) {
      if (isDuplicateError(error)) return res.status(409).json({ error: 'This index/reference number is already on the attendance register.' });
      throw error;
    }
    res.status(201).json({ message: 'Student marked present by lecturer.' });
  } catch (error) { next(error); }
});

app.get('/api/sessions/:id/records', requireLecturer, async (req, res, next) => {
  try {
    const session = await requireOwnedSession(req, res);
    if (!session) return;
    await closeExpired();
    const records = await queryRows('SELECT student_name AS studentName,index_number AS indexNumber,checked_in_at AS checkedInAt,method FROM attendance WHERE session_id=? ORDER BY checked_in_at,id', [session.id]);
    res.json(records);
  } catch (error) { next(error); }
});

app.post('/api/sessions/:id/close', requireLecturer, async (req, res, next) => {
  try {
    const session = await requireOwnedSession(req, res);
    if (!session) return;
    await execute('UPDATE sessions SET closed_at=COALESCE(closed_at,?) WHERE id=?', [now(), session.id]);
    res.json({ message: 'Attendance session closed.' });
  } catch (error) { next(error); }
});

app.get('/api/sessions/:id/export', requireLecturer, async (req, res, next) => {
  try {
    const session = await requireOwnedSession(req, res);
    if (!session) return;
    const rows = await queryRows('SELECT student_name AS studentName,index_number AS indexNumber,checked_in_at AS checkedInAt,method FROM attendance WHERE session_id=? ORDER BY LOWER(student_name)', [session.id]);
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
  } catch (error) { next(error); }
});

app.use((error, _req, res, _next) => {
  console.error(error);
  if (res.headersSent) return;
  res.status(500).json({ error: 'Unexpected server error.' });
});

const PORT = Number(process.env.PORT || 8080);
async function start() {
  try {
    await initializeDatabase();
    await pool.query('SELECT 1');
    app.listen(PORT, () => console.log(`AttendX TiDB API listening on ${PORT}`));
  } catch (error) {
    console.error('AttendX could not connect to TiDB or initialize its schema:', error.message);
    process.exit(1);
  }
}
start();
