'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';

export default function LoginPage() {
  const router = useRouter();
  const { signIn: authSignIn, isLoading: authLoading } = useAuth();
  const containerRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<string>('pending');
  const [error, setError] = useState<string>('');
  const [userCode, setUserCode] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const flowRef = useRef<any>(null);

  useEffect(() => {
    const startFlow = async () => {
      try {
        // Dynamically import QRDeviceFlow (client-only)
        const { QRDeviceFlow } = await import('@qr-device-flow/web');

        if (!containerRef.current) return;

        flowRef.current = new QRDeviceFlow({
          endpoint: process.env.NEXT_PUBLIC_API_URL || 'http://api.localhost:3002/device',
          transport: 'polling',
          onStateChange: (state) => {
            setStatus(state);
            if (state === 'scanned') {
              setStatus('scanned');
            }
          },
          onApproved: async (session) => {
            setStatus('approved');
            setLoading(true);

            // Sign in with the token from QR flow using auth plugin
            const result = await authSignIn(session.accessToken);

            if (result) {
              // Redirect to dashboard after successful login
              setTimeout(() => router.push('/dashboard'), 1000);
            } else {
              setError('Failed to sign in');
              setLoading(false);
            }
          },
          onError: (err) => {
            setError(err.message || 'An error occurred');
            setStatus('error');
          },
        });

        // Start in DOM mode
        await flowRef.current.start({ container: containerRef.current });
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to start QR flow');
      }
    };

    // Wait for auth to be initialized before starting the flow
    if (!authLoading) {
      startFlow();
    }

    return () => {
      flowRef.current?.destroy();
    };
  }, [router, authSignIn, authLoading]);

  const handleRetry = () => {
    setError('');
    setStatus('pending');
    setUserCode('');
    window.location.reload();
  };

  const statusMessages = {
    pending: '⏳ Waiting for scan...',
    scanned: '📱 Phone detected! Confirm on your device...',
    approved: '✅ Approved! Logging in...',
    denied: '❌ Login was denied',
    expired: '⏰ QR code expired',
    error: '⚠️ An error occurred',
  };

  const statusColors = {
    pending: 'bg-blue-50 border-blue-200 text-blue-900',
    scanned: 'bg-blue-50 border-blue-200 text-blue-900',
    approved: 'bg-green-50 border-green-200 text-green-900',
    denied: 'bg-red-50 border-red-200 text-red-900',
    expired: 'bg-gray-50 border-gray-200 text-gray-900',
    error: 'bg-red-50 border-red-200 text-red-900',
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 flex items-center justify-center p-4">
      <div className="max-w-md w-full">
        <div className="bg-white rounded-lg shadow-2xl p-8">
          <h1 className="text-3xl font-bold text-center mb-2 text-gray-900">Sign in</h1>
          <p className="text-center text-gray-600 text-sm mb-8">
            Scan the QR code with your phone to log in instantly
          </p>

          {/* QR Container */}
          <div
            ref={containerRef}
            className="flex justify-center mb-6 min-h-[240px] bg-gray-50 rounded-lg p-4"
          >
            {/* QRDeviceFlow renders here */}
          </div>

          {/* User Code Fallback */}
          {userCode && (
            <div className="text-center mb-6">
              <p className="text-xs text-gray-600 mb-2">Or enter this code on your phone:</p>
              <p className="text-2xl font-mono font-bold text-purple-600 tracking-widest">
                {userCode}
              </p>
            </div>
          )}

          {/* Status */}
          <div className={`border-2 rounded-lg p-3 mb-6 ${statusColors[status as keyof typeof statusColors]}`}>
            <p className="font-semibold text-sm">
              {statusMessages[status as keyof typeof statusMessages] || 'Loading...'}
            </p>
          </div>

          {/* Error */}
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-6">
              <p className="text-red-900 text-sm">{error}</p>
              <button
                onClick={handleRetry}
                className="mt-3 w-full bg-red-600 hover:bg-red-700 text-white font-semibold py-2 px-4 rounded text-sm"
              >
                Try Again
              </button>
            </div>
          )}

          {/* Loading State */}
          {loading && (
            <div className="text-center">
              <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-purple-600"></div>
              <p className="mt-2 text-sm text-gray-600">Signing you in...</p>
            </div>
          )}

          {/* Info */}
          <div className="mt-6 pt-6 border-t border-gray-200">
            <p className="text-xs text-gray-600 text-center">
              💡 This demo uses RFC 8628 Device Authorization Grant
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
