import { useEffect, useState } from 'react';
import { api, me, serverAvailable, type User } from './lib/api';
import { Icon } from './editor/icons';
import { toast } from './lib/toast';

interface Session { id: string; created_at: string; last_seen: string; user_agent: string; current: boolean }

export function Account({ resetToken }: { resetToken?: string }) {
  const [up, setUp] = useState<boolean | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [mode, setMode] = useState<'login' | 'register' | 'recover' | 'reset'>(resetToken ? 'reset' : 'login');
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [totp, setTotp] = useState('');
  const [needTotp, setNeedTotp] = useState(false);
  const [err, setErr] = useState('');
  const [sessions, setSessions] = useState<Session[]>([]);
  const [mfa, setMfa] = useState<{ secret: string; otpauth: string } | null>(null);
  const [code, setCode] = useState('');

  const refresh = async () => {
    const u = await me();
    setUser(u);
    if (u) setSessions(await api<Session[]>('/auth/sessions').catch(() => []));
  };
  useEffect(() => { void serverAvailable().then(setUp); void refresh(); }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr('');
    try {
      if (mode === 'login') {
        const r = await api<User | { mfaRequired: true }>('/auth/login', { body: { email, password, totp: totp || undefined } });
        if ('mfaRequired' in r) { setNeedTotp(true); return; }
      } else if (mode === 'register') {
        await api('/auth/register', { body: { email, password, name } });
      } else if (mode === 'recover') {
        await api('/auth/recover', { body: { email } });
        toast('If that address has an account, a reset link has been sent.', 5000);
        setMode('login');
        return;
      } else if (mode === 'reset') {
        await api('/auth/reset', { body: { token: resetToken, password } });
        toast('Password changed. Sign in with your new password.');
        location.hash = '#/account';
        setMode('login');
        return;
      }
      await refresh();
      const next = sessionStorage.getItem('deck.afterLogin');
      if (next) { sessionStorage.removeItem('deck.afterLogin'); location.hash = next; }
    } catch (e2) {
      setErr((e2 as Error).message);
    }
  };

  if (up === false) return <Shell><h2>No DECK server</h2><p>Accounts, sharing and collaboration need a DECK server. Presentations still work fully on this device. See <code>docs/DEPLOYMENT.md</code>.</p></Shell>;

  if (user) return (
    <Shell>
      <h2>{user.name || user.email}</h2>
      <p className="label">{user.email}</p>
      <section className="sect" style={{ paddingLeft: 0, paddingRight: 0 }}>
        <h4>Two-factor authentication</h4>
        {user.mfa ? (
          <div className="row"><span className="pill"><span className="dot" />Enabled</span>
            <input className="input" style={{ width: 140 }} placeholder="Code to disable" value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" />
            <button className="btn danger" onClick={async () => { try { await api('/auth/mfa/disable', { body: { code } }); setCode(''); await refresh(); } catch (e) { toast((e as Error).message); } }}>Disable</button>
          </div>
        ) : mfa ? (
          <>
            <p style={{ margin: 0 }}>Add this key to your authenticator app, then enter the 6-digit code.</p>
            <code style={{ userSelect: 'all', padding: 8, background: 'var(--raised)', borderRadius: 6, wordBreak: 'break-all' }}>{mfa.secret}</code>
            <div className="row"><input className="input" style={{ width: 140 }} placeholder="123456" inputMode="numeric" value={code} onChange={(e) => setCode(e.target.value)} /><button className="btn primary" onClick={async () => { try { await api('/auth/mfa/enable', { body: { code } }); setMfa(null); setCode(''); await refresh(); toast('Two-factor authentication enabled'); } catch (e) { toast((e as Error).message); } }}>Verify & enable</button></div>
          </>
        ) : <button className="btn ghost-strong" onClick={async () => setMfa(await api('/auth/mfa/setup', { body: {} }))}>Set up authenticator app</button>}
      </section>
      <section className="sect" style={{ paddingLeft: 0, paddingRight: 0 }}>
        <h4>Active sessions</h4>
        {sessions.map((s) => (
          <div key={s.id} className="row"><Icon name="keyboard" /><span style={{ flex: 1 }}>{s.user_agent.slice(0, 80) || 'Unknown device'}<br /><small className="label">Last active {new Date(s.last_seen).toLocaleString()}{s.current ? ' · this device' : ''}</small></span>
            {!s.current && <button className="btn danger" onClick={async () => { await api(`/auth/sessions/${s.id}`, { method: 'DELETE' }); await refresh(); }}>Revoke</button>}
          </div>
        ))}
        <button className="btn ghost-strong" onClick={async () => { await api('/auth/sessions/revoke-others', { body: {} }); await refresh(); toast('Signed out everywhere else'); }}>Sign out all other sessions</button>
      </section>
      <div className="row"><a className="btn ghost-strong" href="#/">Back to presentations</a><span className="spacer" /><button className="btn danger" onClick={async () => { await api('/auth/logout', { body: {} }); setUser(null); }}><Icon name="logout" />Sign out</button></div>
    </Shell>
  );

  return (
    <Shell>
      <h2>{{ login: 'Sign in', register: 'Create your account', recover: 'Reset your password', reset: 'Choose a new password' }[mode]}</h2>
      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {mode === 'register' && <label className="field"><span>Name</span><input className="input" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} /></label>}
        {mode !== 'reset' && <label className="field"><span>Email</span><input className="input" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></label>}
        {mode !== 'recover' && <label className="field"><span>Password {mode !== 'login' && <span className="label">(at least 12 characters)</span>}</span><input className="input" type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} required minLength={mode === 'login' ? 1 : 12} value={password} onChange={(e) => setPassword(e.target.value)} /></label>}
        {needTotp && mode === 'login' && <label className="field"><span>Authenticator code</span><input className="input" inputMode="numeric" autoComplete="one-time-code" autoFocus value={totp} onChange={(e) => setTotp(e.target.value)} /></label>}
        {err && <div className="issue warn" role="alert"><Icon name="warn" />{err}</div>}
        <button className="btn primary" type="submit" style={{ height: 38 }}>{{ login: 'Sign in', register: 'Create account', recover: 'Send reset link', reset: 'Set password' }[mode]}</button>
      </form>
      <div className="row" style={{ marginTop: 10 }}>
        {mode !== 'login' && <button className="btn" onClick={() => setMode('login')}>Have an account? Sign in</button>}
        {mode === 'login' && <button className="btn" onClick={() => setMode('register')}>Create account</button>}
        {mode === 'login' && <button className="btn" onClick={() => setMode('recover')}>Forgot password?</button>}
      </div>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="home">
      <header className="home-top"><a href="#/" className="wordmark" style={{ color: 'inherit', textDecoration: 'none' }}><i />DECK</a></header>
      <div style={{ maxWidth: 440, margin: '64px auto', padding: '0 24px', display: 'flex', flexDirection: 'column', gap: 12 }}>{children}</div>
    </div>
  );
}
