'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

export default function UserLoginPage() {
  return (
    <Suspense fallback={<div className="login-container">Loading...</div>}>
      <UserLoginInner />
    </Suspense>
  );
}

function UserLoginInner() {
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
    const res = await fetch('/user/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    if (res.ok) {
      // ?next= があり、かつローカルパス (// で始まらない) のときだけリダイレクト
      if (next && next.startsWith('/') && !next.startsWith('//')) {
        // フルリロードで遷移 (/authorize は server-side cookie を読むため)
        window.location.href = next;
      } else {
        router.push('/user/recordings');
      }
    } else {
      const data = await res.json();
      setError(data.error || 'Login failed');
    }
  };

  return (
    <div className="login-container">
      <h1>User Login</h1>
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
        />
        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <button type="submit" className="btn btn-primary">Login</button>
      </form>
    </div>
  );
}
