'use client';

import Nav from '@/components/Nav';

/**
 * 認証必須ページ群（/recordings, /settings）の共通レイアウト。
 * Nav は /api/session/me を読んで role に応じたメニューを表示する。
 */
export default function AuthedLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="admin-layout">
      <Nav />
      <div className="admin-content">{children}</div>
    </div>
  );
}
