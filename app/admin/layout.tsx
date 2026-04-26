'use client';

import Nav from '@/components/Nav';

/**
 * Admin 専用機能ページ（/admin/users, /admin/admins, /admin/minutes,
 * /admin/ontology, /admin/evaluation）の共通レイアウト。
 * 認証は middleware で role=admin 強制。
 */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="admin-layout">
      <Nav />
      <div className="admin-content">{children}</div>
    </div>
  );
}
