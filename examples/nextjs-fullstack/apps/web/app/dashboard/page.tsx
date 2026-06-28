'use client';

import { useSession, signOut } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

export default function DashboardPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/login');
    }
  }, [status, router]);

  if (status === 'loading') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 flex items-center justify-center">
        <div className="text-white">Loading...</div>
      </div>
    );
  }

  if (!session) {
    return null;
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800">
      <nav className="bg-black/20 backdrop-blur-md border-b border-white/10">
        <div className="max-w-4xl mx-auto px-4 py-4 flex justify-between items-center">
          <h1 className="text-white text-2xl font-bold">Dashboard</h1>
          <button
            onClick={() => signOut({ redirect: false }).then(() => router.push('/login'))}
            className="bg-red-600 hover:bg-red-700 text-white font-semibold py-2 px-4 rounded"
          >
            Sign Out
          </button>
        </div>
      </nav>

      <div className="max-w-4xl mx-auto px-4 py-12">
        {/* Welcome Card */}
        <div className="bg-white rounded-lg shadow-2xl p-8 mb-8">
          <h2 className="text-3xl font-bold text-gray-900 mb-2">
            Welcome, {session.user?.name}! 🎉
          </h2>
          <p className="text-gray-600">
            You successfully logged in using QR Device Flow (RFC 8628).
          </p>
        </div>

        {/* Session Info */}
        <div className="bg-gray-50 rounded-lg shadow p-6 mb-8">
          <h3 className="text-xl font-bold text-gray-900 mb-4">Session Information</h3>
          <div className="space-y-3 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-600">User ID:</span>
              <span className="font-mono text-gray-900">{session.user?.id}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600">Email:</span>
              <span className="font-mono text-gray-900">{session.user?.email}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600">Session Status:</span>
              <span className="inline-block bg-green-100 text-green-800 px-3 py-1 rounded-full text-xs font-semibold">
                Active
              </span>
            </div>
          </div>
        </div>

        {/* How It Works */}
        <div className="bg-blue-50 rounded-lg shadow p-6 border border-blue-200">
          <h3 className="text-xl font-bold text-blue-900 mb-4">How This Works</h3>
          <ol className="space-y-3 text-blue-900 text-sm list-decimal list-inside">
            <li>Browser requested a challenge via RFC 8628 Device Authorization Grant</li>
            <li>Mobile app scanned the QR code (user_code: ABCD-EFGH format)</li>
            <li>Mobile app showed requester info: browser type, IP, location</li>
            <li>User approved the request on mobile</li>
            <li>Browser received approval, consumed the session atomically</li>
            <li>Server issued a JWT token (single-use, TTL-protected)</li>
            <li>NextAuth.js stored the session in a secure HTTP-only cookie</li>
            <li>You're now logged in ✅</li>
          </ol>
        </div>

        {/* Demo Info */}
        <div className="mt-8 text-center">
          <p className="text-gray-300 text-sm">
            Try opening another tab and going to /login — you'll already be logged in because the session is persistent.
          </p>
        </div>
      </div>
    </div>
  );
}
