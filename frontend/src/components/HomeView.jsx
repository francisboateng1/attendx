export default function HomeView() {
    return <>
        <section className="hero">
            <span className="eyebrow">SMART LECTURE ATTENDANCE</span>
            <h1>Attendance that starts with <span>being there.</span></h1>
            <p>Choose your portal to continue. Students verify their session and location before checking in. Lecturers manage sessions and attendance records.</p>
        </section>
        <div className="portal-grid">
            <a className="portal-card lecturer-portal" href="/lecturer">
                <div className="portal-icon">L</div><span className="eyebrow">FOR TEACHING STAFF</span>
                <h2>Lecturer Portal</h2><p>Start a lecture session, display its section code, monitor check-ins and export the register.</p>
                <span className="portal-link">Open Lecturer Portal <b>→</b></span>
            </a>
            <a className="portal-card student-portal" href="/student">
                <div className="portal-icon">S</div><span className="eyebrow">FOR STUDENTS</span>
                <h2>Student Portal</h2><p>Log in with your index number and section code, verify your location and confirm attendance.</p>
                <span className="portal-link">Open Student Portal <b>→</b></span>
            </a>
        </div>
        <footer className="home-footer">AttendX · Verified Presence. Accountable Attendance.</footer>
    </>;
}
