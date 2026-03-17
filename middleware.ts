import { NextRequest, NextResponse } from 'next/server';

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Admin area protection
  if (pathname.startsWith('/admin') && !pathname.startsWith('/admin/login') && !pathname.startsWith('/admin/api/login')) {
    const session = request.cookies.get('admin_session');
    if (!session) {
      return NextResponse.redirect(new URL('/admin/login', request.url));
    }
  }

  // User area protection
  if (pathname.startsWith('/user') && !pathname.startsWith('/user/login') && !pathname.startsWith('/user/api/login')) {
    const session = request.cookies.get('user_session');
    if (!session) {
      return NextResponse.redirect(new URL('/user/login', request.url));
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/admin/:path*', '/user/:path*'],
};
