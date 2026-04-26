'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

interface SessionInfo {
  userId: string;
  username: string;
  role: 'user' | 'admin';
}

/**
 * 統合ナビゲーション。Cookie session の role に応じてメニュー切替。
 * - user: Recordings / Settings
 * - admin: Recordings / Settings / Users / 議事録 / オントロジー / 評価 / Admins
 */
export default function Nav() {
  const pathname = usePathname();
  const router = useRouter();
  const [session, setSession] = useState<SessionInfo | null>(null);

  useEffect(() => {
    fetch('/api/session/me')
      .then((res) => (res.ok ? res.json() : null))
      .then((data: SessionInfo | null) => {
        if (data) setSession(data);
      });
  }, []);

  const handleLogout = async () => {
    await fetch('/api/session/logout', { method: 'POST' });
    router.push('/login');
  };

  const isActive = (target: string) => pathname === target;
  const startsWith = (prefix: string) => pathname.startsWith(prefix);
  const isAdmin = session?.role === 'admin';

  return (
    <nav className="admin-nav">
      <span className="logo">{isAdmin ? 'Recording Admin' : 'My Recordings'}</span>
      <Link href="/recordings" className={isActive('/recordings') ? 'active' : ''}>Recordings</Link>
      <Link href="/settings" className={isActive('/settings') ? 'active' : ''}>Settings</Link>
      {isAdmin && (
        <>
          <Link href="/admin/users" className={isActive('/admin/users') ? 'active' : ''}>Users</Link>
          <Link href="/admin/minutes" className={startsWith('/admin/minutes') ? 'active' : ''}>議事録</Link>
          <Link href="/admin/ontology" className={startsWith('/admin/ontology') ? 'active' : ''}>オントロジー</Link>
          <Link href="/admin/evaluation" className={startsWith('/admin/evaluation') ? 'active' : ''}>評価</Link>
          <Link href="/admin/admins" className={isActive('/admin/admins') ? 'active' : ''}>Admins</Link>
        </>
      )}
      <span className="spacer" />
      <div className="nav-user">
        {session?.username && <span className="nav-username">{session.username}</span>}
        <button onClick={handleLogout}>Logout</button>
      </div>
    </nav>
  );
}
