export default function Notice({ message, type = 'info' }) {
    if (!message) return null;
    return <div className={`notice notice-${type}`} role="status">{message}</div>;
}
