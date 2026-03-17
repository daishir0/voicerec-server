'use client';

import { usePathname } from 'next/navigation';
import UserNav from '@/components/UserNav';

export default function UserLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isLogin = pathname === '/user/login';

  return (
    <div className="admin-layout">
      {!isLogin && <UserNav />}
      <div className="admin-content">{children}</div>
    </div>
  );
}
