export default function Header({
    subtitle = 'Verified Presence. Accountable Attendance.',
    portal = 'GetAttendX'
}) {
    return (
        <header className="header">
           <a href="/" className="brand">
    <img
        src="/getattendx-logo.png"
        alt="GetAttendX"
        className="brand-logo"
    />
</a>
            {subtitle && <p>{subtitle}</p>}
            {portal !== 'GetAttendX' && <span>{portal}</span>}
        </header>
    );
}