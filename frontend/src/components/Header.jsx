export default function Header({
    subtitle = 'Verified Presence. Accountable Attendance.',
    portal = 'GetAttendX'
}) {
    return (
        <header className="header">
            <a className="logo" href="/" aria-label="GetAttendX home">
                GetAttend<span>X</span>
            </a>
            {subtitle && <p>{subtitle}</p>}
            {portal !== 'GetAttendX' && <span>{portal}</span>}
        </header>
    );
}