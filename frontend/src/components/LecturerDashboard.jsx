import { useState } from 'react';
import AttendanceTable from './AttendanceTable';
import { downloadSessionExport } from '../services/api';
import { getCurrentPosition } from '../utils/geolocation';

const INITIAL_FORM = {
    courseCode: 'CE 279',
    courseName: 'Programming with Java',
    durationMinutes: 20,
    allowedRadiusM: 50
};

export default function LecturerDashboard({
    session,
    records,
    onStart,
    onManualSubmit,
    manual,
    onManualChange,
    onRefresh,
    onClose,
    loading,
    message,
    error,
    lecturer,

    historySessions = [],
    historyLoading = false,
    historyError = '',
    onRefreshHistory,
    onViewHistory,
    viewingHistorySession,
    historyRecords = [],
    historyRecordsLoading = false,
    onBackFromHistory
}) {
    const [form, setForm] = useState(INITIAL_FORM);
    const [starting, setStarting] = useState(false);
    const [startError, setStartError] = useState('');

    const update = (key, value) => {
        setForm(previous => ({
            ...previous,
            [key]: value
        }));
    };

    async function startSession(event) {
        event.preventDefault();

        setStartError('');
        setStarting(true);

        try {
            const location = await getCurrentPosition();

          if (location.accuracy > 300) {
    throw new Error(
        `Your GPS accuracy is approximately ${Math.round(location.accuracy)} metres. ` +
        'Your location is not within the acceptable GPS accuracy range of 300 metres. ' +
        'Please move to an area with a better GPS signal and try again.'
    );
}

            await onStart({
                ...form,
                durationMinutes: Number(form.durationMinutes),
                allowedRadiusM: Number(form.allowedRadiusM),
                latitude: location.latitude,
                longitude: location.longitude,
                locationAccuracy: location.accuracy
            });
        } catch (e) {
            setStartError(e.message);
        } finally {
            setStarting(false);
        }
    }

    const sessionActive = session
        ? !session.closedAt && Date.now() < Date.parse(session.closesAt)
        : false;

    function renderHistory() {
        return (
            <section className="panel subsection history-panel">
                <div className="subsection-heading">
                    <div>
                        <span className="eyebrow">LECTURER RECORDS</span>
                        <h2>
                            Attendance History
                            <span className="count-pill">
                                {historySessions.length}
                            </span>
                        </h2>
                        <p>
                            View attendance records from your previous lecture
                            sessions.
                        </p>
                    </div>

                    <button
                        className="button-quiet"
                        onClick={onRefreshHistory}
                        disabled={historyLoading}
                    >
                        {historyLoading ? 'Refreshing…' : 'Refresh history'}
                    </button>
                </div>

                {historyError && (
                    <NoticeText message={historyError} />
                )}

                {historyLoading && historySessions.length === 0 ? (
                    <p>Loading attendance history…</p>
                ) : historySessions.length === 0 ? (
                    <div className="empty-history">
                        <h3>No attendance history yet</h3>
                        <p>
                            Sessions you conduct will appear here automatically.
                        </p>
                    </div>
                ) : (
                    <div className="history-list">
                        {historySessions.map(item => {
                            const isActive =
                                !item.closedAt &&
                                Date.now() < Date.parse(item.closesAt);

                            const isSelected =
                                viewingHistorySession?.sessionId ===
                                item.sessionId;

                            return (
                                <div
                                    className="history-item"
                                    key={item.sessionId}
                                >
                                    <div className="history-item-info">
                                        <div className="history-item-title">
                                            <h3>{item.courseCode}</h3>

                                            <span
                                                className={
                                                    isActive
                                                        ? 'live-badge'
                                                        : 'closed-badge'
                                                }
                                            >
                                                {isActive ? 'ACTIVE' : 'CLOSED'}
                                            </span>
                                        </div>

                                        <p>{item.courseName}</p>

                                        <div className="history-meta">
                                            <span>
                                                {new Date(
                                                    item.startedAt
                                                ).toLocaleString()}
                                            </span>

                                            <span>
                                                {Number(
                                                    item.attendanceCount || 0
                                                )}{' '}
                                                students
                                            </span>
                                        </div>
                                    </div>

                                    <button
                                        className="button-secondary"
                                        onClick={() => onViewHistory(item)}
                                        disabled={historyRecordsLoading}
                                    >
                                        {isSelected
                                            ? 'Viewing'
                                            : 'View register'}
                                    </button>
                                </div>
                            );
                        })}
                    </div>
                )}
            </section>
        );
    }

    function renderHistoryDetails() {
        if (!viewingHistorySession) return null;

        return (
            <section className="panel historical-details">
                <div className="dashboard-top">
                    <div>
                        <span className="eyebrow">
                            HISTORICAL ATTENDANCE REGISTER
                        </span>

                        <h1>
                            {viewingHistorySession.courseCode}
                            <span className="muted-title">
                                {' '}
                                — {viewingHistorySession.courseName}
                            </span>
                        </h1>

                        <p>
                            Conducted on{' '}
                            {new Date(
                                viewingHistorySession.startedAt
                            ).toLocaleString()}
                        </p>
                    </div>

                    <span className="closed-badge">HISTORY</span>
                </div>

                <div className="stats-grid">
                    <div className="stat-card">
                        <span>Students present</span>
                        <strong>{historyRecords.length}</strong>
                    </div>

                    <div className="stat-card">
                        <span>Student check-ins</span>
                        <strong>
                            {
                                historyRecords.filter(
                                    record => record.method === 'STUDENT'
                                ).length
                            }
                        </strong>
                    </div>

                    <div className="stat-card">
                        <span>Lecturer-assisted</span>
                        <strong>
                            {
                                historyRecords.filter(
                                    record => record.method === 'LECTURER'
                                ).length
                            }
                        </strong>
                    </div>

                    <div className="stat-card">
                        <span>Allowed radius</span>
                        <strong>
                            {viewingHistorySession.allowedRadiusM || 50}m
                        </strong>
                    </div>
                </div>

                <div className="subsection">
                    <div className="subsection-heading">
                        <div>
                            <h2>
                                Attendance register
                                <span className="count-pill">
                                    {historyRecords.length}
                                </span>
                            </h2>

                            <p>
                                Historical student attendance records for this
                                session.
                            </p>
                        </div>
                    </div>

                    {historyRecordsLoading ? (
                        <p>Loading attendance records…</p>
                    ) : (
                        <AttendanceTable records={historyRecords} />
                    )}
                </div>

                <div className="dashboard-actions">
                    <button
                        className="button-quiet"
                        onClick={onBackFromHistory}
                    >
                        ← Start New Attendance Session
                    </button>

                    <button
                        className="button-success"
                        type="button"
                        onClick={() =>
                            downloadSessionExport(
                                viewingHistorySession.sessionId
                            ).catch(e => window.alert(e.message))
                        }
                    >
                        Download Excel Register
                    </button>
                </div>
            </section>
        );
    }

    return (
        <>
            {viewingHistorySession && renderHistoryDetails()}

            {!viewingHistorySession && (
                <>
                    {session ? (
                        <section className="panel dashboard-panel">
                            <div className="dashboard-top">
                                <div>
                                    <span className="eyebrow">
                                        {sessionActive
                                            ? 'ACTIVE LECTURE SESSION'
                                            : 'ATTENDANCE SESSION CLOSED'}
                                    </span>

                                    <h1>
                                        {session.courseCode}
                                        <span className="muted-title">
                                            {' '}
                                            — {session.courseName}
                                        </span>
                                    </h1>

                                    <p>
                                        Lecturer: {session.lecturerName}
                                    </p>
                                </div>

                                <span
                                    className={
                                        sessionActive
                                            ? 'live-badge'
                                            : 'closed-badge'
                                    }
                                >
                                    {sessionActive ? (
                                        <>
                                            <i /> LIVE
                                        </>
                                    ) : (
                                        'CLOSED'
                                    )}
                                </span>
                            </div>

                            {session.sectionCode && (
                                <div className="session-code-box">
                                    <div>
                                        <span className="eyebrow">
                                            STUDENT SECTION CODE
                                        </span>

                                        <p>
                                            Display this code for students to
                                            log in.
                                        </p>
                                    </div>

                                    <strong>{session.sectionCode}</strong>
                                </div>
                            )}

                            <div className="stats-grid">
                                <div className="stat-card">
                                    <span>Students present</span>
                                    <strong>{records.length}</strong>
                                </div>

                                <div className="stat-card">
                                    <span>Student check-ins</span>
                                    <strong>
                                        {
                                            records.filter(
                                                r => r.method === 'STUDENT'
                                            ).length
                                        }
                                    </strong>
                                </div>

                                <div className="stat-card">
                                    <span>Lecturer-assisted</span>
                                    <strong>
                                        {
                                            records.filter(
                                                r => r.method === 'LECTURER'
                                            ).length
                                        }
                                    </strong>
                                </div>

                                <div className="stat-card">
                                    <span>Allowed radius</span>
                                    <strong>
                                        {session.allowedRadiusM || 50}m
                                    </strong>
                                </div>
                            </div>

                            <div className="subsection">
                                <div className="subsection-heading">
                                    <div>
                                        <h2>Manual attendance</h2>
                                        <p>
                                            For students who do not have access
                                            to a phone.
                                        </p>
                                    </div>
                                </div>

                                {sessionActive ? (
                                    <form
                                        className="manual-form"
                                        onSubmit={onManualSubmit}
                                    >
                                        <input
                                            required
                                            placeholder="Student full name"
                                            value={manual.studentName}
                                            onChange={e =>
                                                onManualChange(
                                                    'studentName',
                                                    e.target.value
                                                )
                                            }
                                        />

                                        <input
                                            required
                                            placeholder="Index/reference number"
                                            value={manual.indexNumber}
                                            onChange={e =>
                                                onManualChange(
                                                    'indexNumber',
                                                    e.target.value
                                                )
                                            }
                                        />

                                        <button
                                            className="button-secondary"
                                            disabled={loading}
                                        >
                                            Mark Present
                                        </button>
                                    </form>
                                ) : (
                                    <p className="closed-note">
                                        This session is closed. No further
                                        attendance can be recorded.
                                    </p>
                                )}
                            </div>

                            <div className="subsection">
                                <div className="subsection-heading">
                                    <div>
                                        <h2>
                                            Attendance register
                                            <span className="count-pill">
                                                {records.length}
                                            </span>
                                        </h2>

                                        <p>
                                            Student and lecturer-assisted
                                            check-ins appear together.
                                        </p>
                                    </div>

                                    <button
                                        className="button-quiet"
                                        onClick={onRefresh}
                                    >
                                        Refresh records
                                    </button>
                                </div>

                                <AttendanceTable records={records} />
                            </div>

                            <div className="dashboard-actions">
                                {sessionActive && (
                                    <button
                                        className="button-danger"
                                        onClick={onClose}
                                        disabled={loading}
                                    >
                                        Close Attendance
                                    </button>
                                )}

                                <button
                                    className="button-success"
                                    type="button"
                                    onClick={() =>
                                        downloadSessionExport(
                                            session.sessionId
                                        ).catch(e =>
                                            window.alert(e.message)
                                        )
                                    }
                                >
                                    Download Excel Register
                                </button>
                            </div>
                        </section>
                    ) : (
                        <section className="panel form-panel">
                            <div className="section-heading">
                                <span className="eyebrow">
                                    LECTURER WORKSPACE
                                </span>

                                <h1>Start an attendance session</h1>

                                <p>
                                    Set your lecture details and confirm your
                                    current location. Students must check in
                                    within the permitted radius.
                                </p>
                            </div>

                            <NoticeText
                                message={startError || error || message}
                            />

                            <form
                                onSubmit={startSession}
                                className="form-grid"
                            >
                                <label>
                                    Course code
                                    <input
                                        required
                                        value={form.courseCode}
                                        onChange={e =>
                                            update(
                                                'courseCode',
                                                e.target.value
                                            )
                                        }
                                        placeholder="e.g. CE 279"
                                    />
                                </label>

                                <label>
                                    Course name
                                    <input
                                        required
                                        value={form.courseName}
                                        onChange={e =>
                                            update(
                                                'courseName',
                                                e.target.value
                                            )
                                        }
                                        placeholder="Course title"
                                    />
                                </label>

                                <label>
                                    Lecturer account
                                    <input
                                        value={lecturer?.fullName || ''}
                                        readOnly
                                    />

                                    <small>
                                        Attendance sessions are recorded under
                                        your signed-in account.
                                    </small>
                                </label>

                                <label>
                                    Attendance window (minutes)
                                    <input
                                        required
                                        type="number"
                                        min="1"
                                        max="240"
                                        value={form.durationMinutes}
                                        onChange={e =>
                                            update(
                                                'durationMinutes',
                                                e.target.value
                                            )
                                        }
                                    />
                                </label>

                                <label>
                                    Permitted student distance (metres)
                                    <input
                                        required
                                        type="number"
                                        min="10"
                                        max="200"
                                        value={form.allowedRadiusM}
                                        onChange={e =>
                                            update(
                                                'allowedRadiusM',
                                                e.target.value
                                            )
                                        }
                                    />

                                    <small>
                                        Default: 50 metres. Range: 10–200
                                        metres.
                                    </small>
                                </label>

                                <div className="location-note">
                                    <span className="location-dot" />
                                    Your GPS location will be captured when
                                    you start the session.
                                </div>

                                <button
                                    className="button-primary form-submit"
                                    disabled={starting || loading}
                                >
                                    {starting
                                        ? 'Getting location…'
                                        : loading
                                            ? 'Starting…'
                                            : 'Start Attendance Session'}
                                </button>
                            </form>
                        </section>
                    )}
                </>
            )}

            {renderHistory()}
        </>
    );
}

function NoticeText({ message }) {
    return message ? (
        <div className="notice notice-error" role="alert">
            {message}
        </div>
    ) : null;
}