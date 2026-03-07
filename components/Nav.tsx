'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';

export default function Nav() {
  const pathname = usePathname();
  const router = useRouter();

  const handleLogout = async () => {
    await fetch('/admin/api/logout', { method: 'POST' });
    router.push('/admin/login');
  };

  return (
    <nav className="admin-nav">
      <span className="logo">Recording Admin</span>
      <Link href="/admin/users" className={pathname === '/admin/users' ? 'active' : ''}>Users</Link>
      <Link href="/admin/recordings" className={pathname === '/admin/recordings' ? 'active' : ''}>Recordings</Link>
      <Link href="/admin/minutes" className={pathname.startsWith('/admin/minutes') ? 'active' : ''}>議事録</Link>
      <Link href="/admin/admins" className={pathname === '/admin/admins' ? 'active' : ''}>Admins</Link>
      <span className="spacer" />
      <button onClick={handleLogout}>Logout</button>
    </nav>
  );
}
