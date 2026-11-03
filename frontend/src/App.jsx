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

    const [historySessions, setHistorySessions] = useState([]);
    const [historyLoading, setHistoryLoading] = useState(false);
    const [historyError, setHistoryError] = useState('');

    const [viewingHistorySession, setViewingHistorySession] = useState(null);
    const [historyRecords, setHistoryRecords] = useState([]);
    const [historyRecordsLoading, setHistoryRecordsLoading] = useState(false);

    const [manual, setManual] = useState(MANUAL_INITIAL);
    const [message, setMessage] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        const onPop = () => setPath(window.location.pathname);

        window.addEventListener('popstate', onPop);

        return () => window.removeEventListener('popstate', onPop);
    }, []);

    // Verify an existing lecturer login.
    useEffect(() => {
        let active = true;

        const token = localStorage.getItem(LECTURER_TOKEN_KEY);

        if (!token) {
            setAuthLoading(false);
            return () => {
                active = false;
            };
        }

        apiRequest('/lecturer/me')
            .then(response => response.json())
            .then(data => {
                if (!active) return;

                setLecturer(data.lecturer);
            })
            .catch(() => {
                localStorage.removeItem(LECTURER_TOKEN_KEY);
                setLecturer(null);
            })
            .finally(() => {
                if (active) setAuthLoading(false);
            });

        return () => {
            active = false;
        };
    }, []);

    // Fetch server-side history whenever a lecturer signs in.
    useEffect(() => {
        if (!lecturer?.id) return;

        let active = true;

        async function initializeLecturerDashboard() {
            setHistoryLoading(true);
            setHistoryError('');

            try {
                const response = await apiRequest('/lecturer/sessions');
                const sessions = await response.json();

                if (!active) return;

                setHistorySessions(sessions);

                // Restore only a session that is still active on the server.
                const activeServerSession = sessions.find(item =>
                    !item.closedAt &&
                    Date.parse(item.closesAt) > Date.now()
                );

                const saved = JSON.parse(
                    localStorage.getItem(LECTURER_SESSION_KEY) || 'null'
                );

                const canRestore =
                    saved &&
                    String(saved.lecturerId) === String(lecturer.id) &&
                    activeServerSession &&
                    saved.sessionId === activeServerSession.sessionId;

                if (canRestore) {
                    setSession(saved);
                    setMessage('Welcome back. Your active attendance session has been restored.');
                } else {
                    setSession(null);

                    // Do not delete historical database records.
                    // Remove only an outdated browser session reference.
                    if (saved && (
                        String(saved.lecturerId) !== String(lecturer.id) ||
                        !activeServerSession ||
                        saved.sessionId !== activeServerSession.sessionId
                    )) {
                        localStorage.removeItem(LECTURER_SESSION_KEY);
                    }
                }
            } catch (e) {
                if (active) {
                    setHistoryError(e.message);
                }
            } finally {
                if (active) setHistoryLoading(false);
            }
        }

        initializeLecturerDashboard();

        return () => {
            active = false;
        };
    }, [lecturer?.id]);

    // Poll attendance records for the currently selected session.
    useEffect(() => {
        if (path !== '/lecturer' || !session?.sessionId || !lecturer) {
            return undefined;
        }

        loadRecords(session.sessionId);

        const poll = window.setInterval(
            () => loadRecords(session.sessionId),
            5000
        );

        return () => window.clearInterval(poll);
    }, [path, session?.sessionId, lecturer?.id]);

    function navigate(nextPath) {
        window.history.pushState({}, '', nextPath);
        setPath(nextPath);
        setMessage('');
        setError('');
    }

    async function refreshHistory() {
        if (!lecturer) return;

        setHistoryLoading(true);
        setHistoryError('');

        try {
            const response = await apiRequest('/lecturer/sessions');
            const sessions = await response.json();

            setHistorySessions(sessions);
        } catch (e) {
            setHistoryError(e.message);
        } finally {
            setHistoryLoading(false);
        }
    }

    async function viewHistory(sessionItem) {
        setViewingHistorySession(sessionItem);
        setHistoryRecords([]);
        setHistoryRecordsLoading(true);
        setHistoryError('');

        try {
            const response = await apiRequest(
                `/sessions/${sessionItem.sessionId}/records`
            );

            const data = await response.json();

            setHistoryRecords(data);
        } catch (e) {
            setHistoryError(e.message);
        } finally {
            setHistoryRecordsLoading(false);
        }
    }

    function backFromHistory() {
        setViewingHistorySession(null);
        setHistoryRecords([]);
        setHistoryError('');
    }

    function authenticated(data) {
        localStorage.setItem(LECTURER_TOKEN_KEY, data.token);

        setLecturer(data.lecturer);
        setSession(null);
        setRecords([]);
        setHistorySessions([]);
        setViewingHistorySession(null);
        setHistoryRecords([]);
        setError('');
        setMessage('Welcome to your GetAttendX lecturer dashboard.');
    }

    function logout() {
        localStorage.removeItem(LECTURER_TOKEN_KEY);

        // Keep the browser session reference.
        // The server remains the source of truth for session history.

        setLecturer(null);
        setSession(null);
        setRecords([]);
        setHistorySessions([]);
        setViewingHistorySession(null);
        setHistoryRecords([]);

        setMessage('You have been logged out.');
    }

    async function loadRecords(sessionId = session?.sessionId) {
        if (!sessionId) return;

        try {
            const response = await apiRequest(
                `/sessions/${sessionId}/records`
            );

            const data = await response.json();

            // Do not overwrite current records when viewing history.
            if (sessionId === session?.sessionId) {
                setRecords(data);
            }
        } catch (e) {
            setError(e.message);
        }
    }

    async function startAttendance(formWithLocation) {
        setLoading(true);
        setError('');
        setMessage('');

        try {
            const response = await apiRequest('/sessions', {
                method: 'POST',
                body: JSON.stringify(formWithLocation)
            });

            const created = await response.json();

            setSession(created);

            localStorage.setItem(
                LECTURER_SESSION_KEY,
                JSON.stringify(created)
            );

            setRecords([]);
            setViewingHistorySession(null);
            setHistoryRecords([]);

            setMessage(
                'Attendance session started. Share the section code with your students.'
            );

            await refreshHistory();
        } catch (e) {
            setError(e.message);
            throw e;
        } finally {
            setLoading(false);
        }
    }

    async function manualAttendance(event) {
        event.preventDefault();

        if (!session) return;

        setLoading(true);
        setError('');

        try {
            const response = await apiRequest(
                `/sessions/${session.sessionId}/manual`,
                {
                    method: 'POST',
                    body: JSON.stringify(manual)
                }
            );

            const result = await response.json();

            setMessage(result.message);
            setManual(MANUAL_INITIAL);

            await loadRecords();
        } catch (e) {
            setError(e.message);
        } finally {
            setLoading(false);
        }
    }

    async function closeAttendance() {
        if (
            !session ||
            !window.confirm(
                'Close this attendance session? Students will no longer be able to check in.'
            )
        ) {
            return;
        }

        setLoading(true);
        setError('');

        try {
            const response = await apiRequest(
                `/sessions/${session.sessionId}/close`,
                { method: 'POST' }
            );

            const result = await response.json();

            setSession(previous => {
                const updated = {
                    ...previous,
                    closedAt: new Date().toISOString()
                };

                localStorage.setItem(
                    LECTURER_SESSION_KEY,
                    JSON.stringify(updated)
                );

                return updated;
            });

            setMessage(result.message);

            await loadRecords();
            await refreshHistory();
        } catch (e) {
            setError(e.message);
        } finally {
            setLoading(false);
        }
    }

    if (path === '/student') {
        return <StudentCheckIn />;
    }

    if (path === '/lecturer') {
        return (
            <main className="app-main">
                <Header
                    portal="LECTURER PORTAL"
                    subtitle="Manage lecture sessions and attendance records."
                />

                <div className="page-toolbar">
                    <button
                        className="button-quiet"
                        onClick={() => navigate('/')}
                    >
                        ← All portals
                    </button>

                    {lecturer && (
                        <>
                            <span className="lecturer-account-label">
                                Signed in as {lecturer.fullName}
                            </span>

                            <button
                                className="button-quiet"
                                onClick={logout}
                            >
                                Log out
                            </button>
                        </>
                    )}

                    {lecturer && session && (
                        <button
                            className="button-quiet"
                            onClick={() => {
                                setSession(null);
                                setRecords([]);
                                setMessage('You can now start another session.');
                            }}
                        >
                            Start another session
                        </button>
                    )}
                </div>

                <Notice
                    message={error || message}
                    type={error ? 'error' : 'info'}
                />

                {authLoading ? (
                    <section className="panel form-panel">
                        <p>Verifying lecturer account…</p>
                    </section>
                ) : !lecturer ? (
                    <LecturerAuth onAuthenticated={authenticated} />
                ) : (
                    <LecturerDashboard
                        lecturer={lecturer}
                        session={session}
                        records={records}
                        manual={manual}
                        onManualChange={(key, value) =>
                            setManual(previous => ({
                                ...previous,
                                [key]: value
                            }))
                        }
                        onManualSubmit={manualAttendance}
                        onRefresh={() => loadRecords()}
                        onStart={startAttendance}
                        onClose={closeAttendance}
                        loading={loading}
                        error={error}
                        message={message}
                        historySessions={historySessions}
                        historyLoading={historyLoading}
                        historyError={historyError}
                        onRefreshHistory={refreshHistory}
                        onViewHistory={viewHistory}
                        viewingHistorySession={viewingHistorySession}
                        historyRecords={historyRecords}
                        historyRecordsLoading={historyRecordsLoading}
                        onBackFromHistory={backFromHistory}
                    />
                )}
            </main>
        );
    }

    return (
        <main className="app-main">
            <Header />
            <HomeView />
        </main>
    );
}