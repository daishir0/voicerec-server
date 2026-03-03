'use client';

import { usePathname } from 'next/navigation';
import Nav from '@/components/Nav';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isLogin = pathname === '/admin/login';

  return (
    <div className="admin-layout">
      {!isLogin && <Nav />}
      <div className="admin-content">{children}</div>
    </div>
  );
}
