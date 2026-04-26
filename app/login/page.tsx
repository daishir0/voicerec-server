'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

/**
 * 統合ログインページ（user / admin 共用）。
 * 認証成功時、role に応じた既定遷移先（user→/recordings、admin→/admin/users）に飛ぶ。
 * `?next=` 指定があれば優先（ローカルパスのみ許可）。
 */
export default function LoginPage() {
  return (
    <Suspense fallback={<div className="login-container">Loading...</div>}>
      <LoginInner />
    </Suspense>
  );
}

function LoginInner() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get('next');
  const hint = searchParams.get('hint');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const res = await fetch('/api/session/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error || 'Login failed');
      return;
    }
    const data = (await res.json()) as { role: 'user' | 'admin' };

    // ?next= があり、かつローカルパス (// で始まらない) のときだけリダイレクト
    if (next && next.startsWith('/') && !next.startsWith('//')) {
      // フルリロードで遷移 (/authorize は server-side cookie を読むため)
      window.location.href = next;
      return;
    }
    router.push(data.role === 'admin' ? '/admin/users' : '/recordings');
  };

  return (
    <div className="login-container">
      <h1>Login</h1>
      {hint && (
        <p
          style={{
            padding: '10px 14px',
            background: '#fff4e5',
            border: '1px solid #ffb84d',
            borderRadius: 6,
            color: '#7a4500',
            marginBottom: 12,
            fontSize: 14,
          }}
        >
          {hint}
        </p>
      )}
      {error && <p className="error">{error}</p>}
      <form onSubmit={handleSubmit}>
        <input
          type="text"
          placeholder="Username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoComplete="username"
          autoFocus
        />
        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
        />
        <button type="submit" className="btn btn-primary">Login</button>
      </form>
    </div>
  );
}
