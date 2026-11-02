import { useState } from 'react';
import { apiRequest } from '../services/api';

export default function LecturerAuth({ onAuthenticated }) {
    const [mode, setMode] = useState('login');
    const [form, setForm] = useState({ fullName: '', email: '', password: '' });
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const isRegister = mode === 'register';

    async function submit(event) {
        event.preventDefault(); setBusy(true); setError('');
        try {
            const response = await apiRequest(`/lecturer/${isRegister ? 'register' : 'login'}`, {
                method: 'POST', body: JSON.stringify(form)
            });
            onAuthenticated(await response.json());
        } catch (e) { setError(e.message); }
        finally { setBusy(false); }
    }

    return <section className="panel form-panel lecturer-auth-panel">
        <div className="section-heading"><span className="eyebrow">SECURE LECTURER ACCESS</span><h1>{isRegister ? 'Create your lecturer account' : 'Welcome back'}</h1><p>{isRegister ? 'Register once to manage your lecture attendance sessions and records.' : 'Log in to access your lecturer dashboard and attendance history.'}</p></div>
        {error && <div className="notice notice-error" role="alert">{error}</div>}
        <form onSubmit={submit} className="form-grid lecturer-auth-form">
            {isRegister && <label>Full name<input required minLength="3" maxLength="120" autoComplete="name" value={form.fullName} onChange={e => setForm(v => ({ ...v, fullName: e.target.value }))} placeholder="Your full name" /></label>}
            <label>Email address<input required type="email" autoComplete="email" value={form.email} onChange={e => setForm(v => ({ ...v, email: e.target.value }))} placeholder="name@university.edu" /></label>
            <label>Password<input required type="password" minLength={isRegister ? 10 : 1} autoComplete={isRegister ? 'new-password' : 'current-password'} value={form.password} onChange={e => setForm(v => ({ ...v, password: e.target.value }))} placeholder={isRegister ? 'At least 10 characters' : 'Enter your password'} /></label>
            <button className="button-primary form-submit" disabled={busy}>{busy ? 'Please wait…' : isRegister ? 'Create Lecturer Account' : 'Log In to Dashboard'}</button>
        </form>
        <p className="auth-switch">{isRegister ? 'Already have an account?' : 'New to GetAttendX?'} <button type="button" onClick={() => { setMode(isRegister ? 'login' : 'register'); setError(''); }}> {isRegister ? 'Log in' : 'Create an account'}</button></p>
        <p className="auth-security-note">Passwords are securely hashed before storage. Your lecturer account protects your attendance sessions and registers.</p>
    </section>;
}
