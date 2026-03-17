'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

export default function UserNav() {
  const pathname = usePathname();
  const router = useRouter();
  const [username, setUsername] = useState('');

  useEffect(() => {
    fetch('/user/api/me').then(res => res.ok ? res.json() : null).then(data => {
      if (data) setUsername(data.username);
    });
  }, []);

  const handleLogout = async () => {
    await fetch('/user/api/logout', { method: 'POST' });
    router.push('/user/login');
  };

  return (
    <nav className="admin-nav">
      <span className="logo">My Recordings</span>
      <Link href="/user/recordings" className={pathname === '/user/recordings' ? 'active' : ''}>Recordings</Link>
      <span className="spacer" />
      {username && <span style={{ color: '#aaa', marginRight: '1rem' }}>{username}</span>}
      <button onClick={handleLogout}>Logout</button>
    </nav>
  );
}
