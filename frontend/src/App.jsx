import { useEffect, useState } from 'react';
import Header from './components/Header';
import HomeView from './components/HomeView';
import LecturerDashboard from './components/LecturerDashboard';
import LecturerAuth from './components/LecturerAuth';
import StudentCheckIn from './components/StudentCheckIn';
import Notice from './components/Notice';
import { apiRequest } from './services/api';

const LECTURER_SESSION_KEY = 'attendxLecturerSession';
const LECTURER_TOKEN_KEY = 'attendxLecturerToken';
const MANUAL_INITIAL = { studentName: '', indexNumber: '' };

export default function App() {
    const [path, setPath] = useState(window.location.pathname);
    const [lecturer, setLecturer] = useState(null);
    const [authLoading, setAuthLoading] = useState(true);
    const [session, setSession] = useState(null);
    const [records, setRecords] = useState([]);
    const [manual, setManual] = useState(MANUAL_INITIAL);
    const [message, setMessage] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        const onPop = () => setPath(window.location.pathname);
        window.addEventListener('popstate', onPop);
        return () => window.removeEventListener('popstate', onPop);
    }, []);

    useEffect(() => {
        let active = true;
        const token = localStorage.getItem(LECTURER_TOKEN_KEY);
        if (!token) { setAuthLoading(false); return () => { active = false; }; }
        apiRequest('/lecturer/me').then(r => r.json()).then(data => {
            if (!active) return;
            setLecturer(data.lecturer);
            try {
                const saved = JSON.parse(localStorage.getItem(LECTURER_SESSION_KEY) || 'null');
                if (saved?.lecturerId === data.lecturer.id) setSession(saved);
                else localStorage.removeItem(LECTURER_SESSION_KEY);
            } catch { localStorage.removeItem(LECTURER_SESSION_KEY); }
        }).catch(() => { localStorage.removeItem(LECTURER_TOKEN_KEY); localStorage.removeItem(LECTURER_SESSION_KEY); })
          .finally(() => { if (active) setAuthLoading(false); });
        return () => { active = false; };
    }, []);

    useEffect(() => {
        if (path !== '/lecturer' || !session?.sessionId || !lecturer) return undefined;
        loadRecords(session.sessionId);
        const poll = window.setInterval(() => loadRecords(session.sessionId), 5000);
        return () => window.clearInterval(poll);
    }, [path, session?.sessionId, lecturer?.id]);

    function navigate(nextPath) {
        window.history.pushState({}, '', nextPath);
        setPath(nextPath); setMessage(''); setError('');
    }

    function authenticated(data) {
        localStorage.setItem(LECTURER_TOKEN_KEY, data.token);
        localStorage.removeItem(LECTURER_SESSION_KEY);
        setLecturer(data.lecturer); setSession(null); setRecords([]); setError(''); setMessage('Welcome to your GetAttendX lecturer dashboard.');
    }

    function logout() {
        localStorage.removeItem(LECTURER_TOKEN_KEY); localStorage.removeItem(LECTURER_SESSION_KEY);
        setLecturer(null); setSession(null); setRecords([]); setMessage('You have been logged out.');
    }

    async function loadRecords(sessionId = session?.sessionId) {
        if (!sessionId) return;
        try { const response = await apiRequest(`/sessions/${sessionId}/records`); setRecords(await response.json()); }
        catch (e) { setError(e.message); }
    }

    async function startAttendance(formWithLocation) {
        setLoading(true); setError(''); setMessage('');
        try {
            const response = await apiRequest('/sessions', { method: 'POST', body: JSON.stringify(formWithLocation) });
            const created = await response.json();
            setSession(created); localStorage.setItem(LECTURER_SESSION_KEY, JSON.stringify(created));
            setRecords([]); setMessage('Attendance session started. Share the section code with your students.');
        } catch (e) { setError(e.message); throw e; }
        finally { setLoading(false); }
    }

    async function manualAttendance(event) {
        event.preventDefault(); if (!session) return;
        setLoading(true); setError('');
        try {
            const response = await apiRequest(`/sessions/${session.sessionId}/manual`, { method: 'POST', body: JSON.stringify(manual) });
            const result = await response.json(); setMessage(result.message); setManual(MANUAL_INITIAL); await loadRecords();
        } catch (e) { setError(e.message); }
        finally { setLoading(false); }
    }

    async function closeAttendance() {
        if (!session || !window.confirm('Close this attendance session? Students will no longer be able to check in.')) return;
        setLoading(true); setError('');
        try {
            const response = await apiRequest(`/sessions/${session.sessionId}/close`, { method: 'POST' });
            const result = await response.json();
            setSession(previous => { const updated = { ...previous, closedAt: new Date().toISOString() }; localStorage.setItem(LECTURER_SESSION_KEY, JSON.stringify(updated)); return updated; });
            setMessage(result.message); await loadRecords();
        } catch (e) { setError(e.message); }
        finally { setLoading(false); }
    }

    if (path === '/student') return <StudentCheckIn />;
    if (path === '/lecturer') return <main className="app-main">
        <Header portal="LECTURER PORTAL" subtitle="Manage lecture sessions and attendance records." />
        <div className="page-toolbar"><button className="button-quiet" onClick={() => navigate('/')}>← All portals</button>{lecturer && <><span className="lecturer-account-label">Signed in as {lecturer.fullName}</span><button className="button-quiet" onClick={logout}>Log out</button></>}{lecturer && session && <button className="button-quiet" onClick={() => { setSession(null); setRecords([]); localStorage.removeItem(LECTURER_SESSION_KEY); setMessage('You can now start another session.'); }}>Start another session</button>}</div>
        <Notice message={error || message} type={error ? 'error' : 'info'} />
        {authLoading ? <section className="panel form-panel"><p>Verifying lecturer account…</p></section> : !lecturer ? <LecturerAuth onAuthenticated={authenticated} /> : <LecturerDashboard lecturer={lecturer} session={session} records={records} manual={manual} onManualChange={(key, value) => setManual(v => ({ ...v, [key]: value }))} onManualSubmit={manualAttendance} onRefresh={() => loadRecords()} onStart={startAttendance} onClose={closeAttendance} loading={loading} error={error} message={message} />}
    </main>;
    return <main className="app-main"><Header/><HomeView/></main>;
}
