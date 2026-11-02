import { useEffect, useState } from 'react';
import { apiRequest } from '../services/api';
import { getDeviceKey } from '../utils/device';

const TOKEN_KEY = 'attendxStudentToken';
const EXPIRY_KEY = 'attendxStudentExpiry';
const AUTH_KEY = 'attendxStudentContext';

function getCurrentPosition() {
    return new Promise((resolve, reject) => {
        if (!navigator.geolocation) return reject(new Error('This browser does not support GPS location.'));
        navigator.geolocation.getCurrentPosition(
            position => resolve({ latitude: position.coords.latitude, longitude: position.coords.longitude, accuracy: position.coords.accuracy }),
            error => reject(new Error(error.code === 1 ? 'Location permission is required to check in.' : 'Could not verify your location. Enable GPS and try again.')),
            { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 }
        );
    });
}

export default function StudentCheckIn() {
    const [credentials, setCredentials] = useState({ indexNumber: '', sectionCode: '' });
    const [studentName, setStudentName] = useState('');
    const [context, setContext] = useState(null);
    const [token, setToken] = useState('');
    const [expiresAt, setExpiresAt] = useState(0);
    const [remaining, setRemaining] = useState(0);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState(null);

    function clearLogin() {
        sessionStorage.removeItem(TOKEN_KEY); sessionStorage.removeItem(EXPIRY_KEY); sessionStorage.removeItem(AUTH_KEY);
        setToken(''); setContext(null); setSuccess(null); setStudentName(''); setExpiresAt(0); setRemaining(0);
    }

    useEffect(() => {
        const savedToken = sessionStorage.getItem(TOKEN_KEY);
        if (!savedToken) return;
        let active = true;
        apiRequest('/student/me', { headers: { Authorization: `Bearer ${savedToken}` } })
            .then(response => response.json())
            .then(data => {
                if (!active) return;
                const expiry = Number(sessionStorage.getItem(EXPIRY_KEY)) || data.expiresAt;
                if (Date.now() >= expiry) { clearLogin(); return; }
                setToken(savedToken); setExpiresAt(expiry); setContext(data);
                if (data.alreadyCheckedIn) setSuccess(data.attendance);
            })
            .catch(() => { if (active) clearLogin(); });
        return () => { active = false; };
    }, []);

    useEffect(() => {
        if (!token || !expiresAt) return undefined;
        const tick = () => {
            const seconds = Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000));
            setRemaining(seconds);
            if (seconds <= 0) { clearLogin(); setError('Your 10-minute login period has ended. Please log in again.'); }
        };
        tick();
        const timer = window.setInterval(tick, 1000);
        return () => window.clearInterval(timer);
    }, [token, expiresAt]);

    async function login(event) {
        event.preventDefault(); setBusy(true); setError('');
        try {
            const response = await apiRequest('/student/login', { method: 'POST', body: JSON.stringify(credentials) });
            const data = await response.json();
            sessionStorage.setItem(TOKEN_KEY, data.token); sessionStorage.setItem(EXPIRY_KEY, String(data.expiresAt));
            setToken(data.token); setExpiresAt(data.expiresAt); setContext(data);
            if (data.alreadyCheckedIn) setSuccess(data.attendance);
        } catch (e) { setError(e.message); }
        finally { setBusy(false); }
    }

    async function checkIn(event) {
        event.preventDefault(); setBusy(true); setError('');
        try {
            const location = await getCurrentPosition();
            const response = await apiRequest('/student/check-in', {
                method: 'POST', headers: { Authorization: `Bearer ${token}` },
                body: JSON.stringify({ studentName, deviceKey: getDeviceKey(), location })
            });
            const result = await response.json();
            setSuccess({ studentName: result.studentName, indexNumber: result.indexNumber, checkedInAt: result.checkedInAt, method: 'STUDENT' });
        } catch (e) { setError(e.message); }
        finally { setBusy(false); }
    }

    const loggedIn = Boolean(token && context);
    const minutes = String(Math.floor(remaining / 60)).padStart(2, '0');
    const seconds = String(remaining % 60).padStart(2, '0');

    return <div className="student-shell">
        <div className="student-brand"><span className="student-brand-mark">A</span><div><strong>AttendX</strong><small>STUDENT PORTAL</small></div></div>
        {!loggedIn ? <section className="student-card">
            <span className="eyebrow">STUDENT ACCESS</span><h1>Log in to your lecture</h1><p className="muted">Use the index number and active section code provided by your lecturer.</p>
            {error && <div className="notice notice-error">{error}</div>}
            <form onSubmit={login} className="student-form">
                <label>Index / reference number<input required autoComplete="username" value={credentials.indexNumber} onChange={e => setCredentials(v => ({ ...v, indexNumber: e.target.value }))} placeholder="Enter your index number" /></label>
                <label>Section code<input required inputMode="numeric" maxLength="6" autoComplete="one-time-code" value={credentials.sectionCode} onChange={e => setCredentials(v => ({ ...v, sectionCode: e.target.value.replace(/\D/g, '').slice(0, 6) }))} placeholder="6-digit code" /></label>
                <button className="button-primary full-width" disabled={busy}>{busy ? 'Verifying…' : 'Log In'}</button>
            </form>
            <div className="student-hint">Your login is valid for exactly 10 minutes. The timer cannot be restarted by refreshing the page.</div>
        </section> : <section className="student-card student-session-card">
            <div className="student-session-top"><span className="eyebrow">{success ? 'ATTENDANCE CONFIRMED' : 'ACTIVE LECTURE'}</span><div className="timer-chip"><span/> {minutes}:{seconds} remaining</div></div>
            <h1>{context.session.courseCode}</h1><p className="course-title">{context.session.courseName}</p><div className="student-meta"><span>INDEX NUMBER</span><strong>{context.student.indexNumber}</strong><span>LECTURER</span><strong>{context.session.lecturerName}</strong><span>LOCATION RULE</span><strong>Within {context.session.allowedRadiusM} metres</strong></div>
            {error && <div className="notice notice-error">{error}</div>}
            {success ? <div className="success-panel"><div className="success-check">✓</div><h2>Congratulations!</h2><p>Your attendance has been successfully recorded.</p><div className="success-details"><span>Student</span><strong>{success.studentName}</strong><span>Index number</span><strong>{success.indexNumber}</strong><span>Check-in time</span><strong>{new Date(success.checkedInAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</strong><span>Status</span><strong className="present-text">PRESENT</strong></div></div> : <>
                <div className="location-required"><span className="location-dot"/><div><strong>Location verification required</strong><p>Allow GPS access when prompted. You must be within the lecturer's permitted distance.</p></div></div>
                <form onSubmit={checkIn} className="student-form"><label>Your full name<input required maxLength="120" autoComplete="name" value={studentName} onChange={e => setStudentName(e.target.value)} placeholder="Enter your full name" /></label><button className="button-primary full-width" disabled={busy}>{busy ? 'Verifying location & checking in…' : 'Check In'}</button></form>
            </>}
            <div className="fixed-login-note">You cannot log out manually. AttendX will automatically end this login when the 10-minute timer expires.</div>
        </section>}
        <footer className="student-footer"><a href="/">AttendX home</a><span>Verified Presence. Accountable Attendance.</span></footer>
    </div>;
}
