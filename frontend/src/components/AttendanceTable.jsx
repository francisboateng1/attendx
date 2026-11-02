function formatCheckInTime(value) {
    if (!value) return '—';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '—' : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export default function AttendanceTable({ records }) {
    return <div className="tablewrap"><table>
        <thead><tr><th>#</th><th>Student name</th><th>Index number</th><th>Time</th><th>Method</th></tr></thead>
        <tbody>
            {records.map((record, index) => <tr key={`${record.indexNumber}-${index}`}>
                <td>{index + 1}</td><td>{record.studentName}</td><td>{record.indexNumber}</td><td>{formatCheckInTime(record.checkedInAt)}</td>
                <td><span className={`badge ${record.method === 'STUDENT' ? 'badge-blue' : 'badge-green'}`}>{record.method === 'STUDENT' ? 'Student' : 'Lecturer'}</span></td>
            </tr>)}
            {records.length === 0 && <tr><td colSpan="5" className="empty-cell">No attendance records yet.</td></tr>}
        </tbody>
    </table></div>;
}
