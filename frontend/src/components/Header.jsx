export default function Header({ subtitle = 'Verified Presence. Accountable Attendance.', portal = 'AttendX' }) {
    return <header className="site-header">
        <a className="logo" href="/" aria-label="AttendX home">Attend<span>X</span></a>
        <div className="header-copy"><strong>{portal}</strong><p>{subtitle}</p></div>
    </header>;
}
