const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8080/api';

export async function apiRequest(path, options = {}) {
    const response = await fetch(`${API_BASE_URL}${path}`, {
        ...options,
        headers: { 'Content-Type': 'application/json', ...(localStorage.getItem('attendxLecturerToken') ? { Authorization: `Bearer ${localStorage.getItem('attendxLecturerToken')}` } : {}), ...(options.headers || {}) }
    });
    if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Request failed' }));
        throw new Error(errorData.error || 'Request failed');
    }
    return response;
}

export async function downloadSessionExport(sessionId) {
    const token = localStorage.getItem('attendxLecturerToken');
    const response = await fetch(`${API_BASE_URL}/sessions/${sessionId}/export`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    if (!response.ok) { const data = await response.json().catch(() => ({})); throw new Error(data.error || 'Could not download the attendance register.'); }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `AttendX_Attendance_${sessionId}.xlsx`;
    document.body.appendChild(anchor); anchor.click(); anchor.remove(); URL.revokeObjectURL(url);
}

