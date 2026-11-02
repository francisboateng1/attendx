import { useState } from 'react';
import AttendanceTable from './AttendanceTable';
import { downloadSessionExport } from '../services/api';

const INITIAL_FORM = { courseCode: 'CE 279', courseName: 'Programming with Java', durationMinutes: 20, allowedRadiusM: 50 };

function getCurrentPosition() {
    return new Promise((resolve, reject) => {
        if (!navigator.geolocation) return reject(new Error('This browser does not support GPS location.'));
        let best = null; let watchId; let finished = false;
        const finish = () => {
            if (finished) return; finished = true;
            if (watchId != null) navigator.geolocation.clearWatch(watchId);
            if (!best) return reject(new Error('Could not obtain your location. Check that Windows Location Services and browser location permission are enabled.'));
            if (best.coords.accuracy > 250) return reject(new Error(`Your best GPS reading is accurate to about ${Math.round(best.coords.accuracy)} metres. Windows/browser location is too imprecise for a reliable lecture reference. Enable Windows Location Services, move near an outside window and try again.`));
            resolve({ latitude: best.coords.latitude, longitude: best.coords.longitude, locationAccuracy: best.coords.accuracy });
        };
        watchId = navigator.geolocation.watchPosition(position => {
            if (!best || position.coords.accuracy < best.coords.accuracy) best = position;
            if (best.coords.accuracy <= 60) finish();
        }, error => {
            if (error.code === 1) { if (!finished) { finished = true; if (watchId != null) navigator.geolocation.clearWatch(watchId); reject(new Error('Location permission is required. Allow location access for this browser and try again.')); } }
        }, { enableHighAccuracy: true, timeout: 25000, maximumAge: 10000 });
        window.setTimeout(finish, 12000);
    });
}

export default function LecturerDashboard({ session, records, onStart, onManualSubmit, manual, onManualChange, onRefresh, onClose, loading, message, error, lecturer }) {
    const [form, setForm] = useState(INITIAL_FORM);
    const [starting, setStarting] = useState(false);
    const [startError, setStartError] = useState('');
    const update = (key, value) => setForm(previous => ({ ...previous, [key]: value }));

    async function startSession(event) {
        event.preventDefault(); setStartError(''); setStarting(true);
        try {
            const location = await getCurrentPosition();
            await onStart({ ...form, durationMinutes: Number(form.durationMinutes), allowedRadiusM: Number(form.allowedRadiusM), ...location });
        } catch (e) { setStartError(e.message); }
        finally { setStarting(false); }
    }

    if (!session) return <section className="panel form-panel">
        <div className="section-heading"><span className="eyebrow">LECTURER WORKSPACE</span><h1>Start an attendance session</h1><p>Set your lecture details and confirm your current location. Students must check in within the permitted radius.</p></div>
        <NoticeText message={startError || error || message} />
        <form onSubmit={startSession} className="form-grid">
            <label>Course code<input required value={form.courseCode} onChange={e => update('courseCode', e.target.value)} placeholder="e.g. CE 279" /></label>
            <label>Course name<input required value={form.courseName} onChange={e => update('courseName', e.target.value)} placeholder="Course title" /></label>
            <label>Lecturer account<input value={lecturer?.fullName || ''} readOnly /><small>Attendance sessions are recorded under your signed-in account.</small></label>
            <label>Attendance window (minutes)<input required type="number" min="1" max="240" value={form.durationMinutes} onChange={e => update('durationMinutes', e.target.value)} /></label>
            <label>Permitted student distance (metres)<input required type="number" min="10" max="200" value={form.allowedRadiusM} onChange={e => update('allowedRadiusM', e.target.value)} /><small>Default: 50 metres. Range: 10–200 metres.</small></label>
            <div className="location-note"><span className="location-dot"/> Your GPS location will be captured when you start the session.</div>
            <button className="button-primary form-submit" disabled={starting || loading}>{starting ? 'Getting location…' : loading ? 'Starting…' : 'Start Attendance Session'}</button>
        </form>
    </section>;

    const sessionActive = !session.closedAt && Date.now() < Date.parse(session.closesAt);

    return <section className="panel dashboard-panel">
        <div className="dashboard-top"><div><span className="eyebrow">{sessionActive ? 'ACTIVE LECTURE SESSION' : 'ATTENDANCE SESSION CLOSED'}</span><h1>{session.courseCode} <span className="muted-title">— {session.courseName}</span></h1><p>Lecturer: {session.lecturerName}</p></div><span className={sessionActive ? 'live-badge' : 'closed-badge'}>{sessionActive ? <><i/> LIVE</> : 'CLOSED'}</span></div>
        <div className="session-code-box"><div><span className="eyebrow">STUDENT SECTION CODE</span><p>Display this code for students to log in.</p></div><strong>{session.sectionCode}</strong></div>
        <div className="stats-grid"><div className="stat-card"><span>Students present</span><strong>{records.length}</strong></div><div className="stat-card"><span>Student check-ins</span><strong>{records.filter(r => r.method === 'STUDENT').length}</strong></div><div className="stat-card"><span>Lecturer-assisted</span><strong>{records.filter(r => r.method === 'LECTURER').length}</strong></div><div className="stat-card"><span>Allowed radius</span><strong>{session.allowedRadiusM || 50}m</strong></div></div>
        <div className="subsection"><div className="subsection-heading"><div><h2>Manual attendance</h2><p>For students who do not have access to a phone.</p></div></div>
            {sessionActive ? <form className="manual-form" onSubmit={onManualSubmit}><input required placeholder="Student full name" value={manual.studentName} onChange={e => onManualChange('studentName', e.target.value)} /><input required placeholder="Index/reference number" value={manual.indexNumber} onChange={e => onManualChange('indexNumber', e.target.value)} /><button className="button-secondary" disabled={loading}>Mark Present</button></form> : <p className="closed-note">This session is closed. No further attendance can be recorded.</p>}
        </div>
        <div className="subsection"><div className="subsection-heading"><div><h2>Attendance register <span className="count-pill">{records.length}</span></h2><p>Student and lecturer-assisted check-ins appear together.</p></div><button className="button-quiet" onClick={onRefresh}>Refresh records</button></div><AttendanceTable records={records}/></div>
        <div className="dashboard-actions">{sessionActive && <button className="button-danger" onClick={onClose} disabled={loading}>Close Attendance</button>}<button className="button-success" type="button" onClick={() => downloadSessionExport(session.sessionId).catch(e => window.alert(e.message))}>Download Excel Register</button></div>
    </section>;
}
function NoticeText({ message }) { return message ? <div className="notice notice-error" role="alert">{message}</div> : null; }
