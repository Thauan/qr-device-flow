'use client';

import { useSearchParams } from 'next/navigation';
import { useState } from 'react';

export default function ConnectPage() {
  const searchParams = useSearchParams();
  const userCode = searchParams.get('user_code') || '';

  const [code, setCode] = useState(userCode);
  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error' | 'info'; message: string } | null>(null);
  const [userId, setUserId] = useState('mobile-user-001');
  const [challengeDetails, setChallengeDetails] = useState<any>(null);

  const handleScan = async (userCodeInput: string) => {
    const normalized = userCodeInput.toUpperCase().replace(/\s/g, '');
    setCode(normalized);

    if (!normalized) return;

    setLoading(true);
    setFeedback(null);

    try {
      // Step 1: Scan to get challenge details
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/device/scan`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${userId}`,
        },
        body: JSON.stringify({ user_code: normalized }),
      });

      if (!res.ok) {
        const error = await res.json();
        setFeedback({
          type: 'error',
          message: error.error || 'Invalid code',
        });
        return;
      }

      const details = await res.json();
      setChallengeDetails(details);
      setFeedback({
        type: 'info',
        message: `✓ Challenge found! Ready to approve or deny.`,
      });
    } catch (err) {
      setFeedback({
        type: 'error',
        message: err instanceof Error ? err.message : 'Failed to scan',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleApprove = async () => {
    if (!code) return;

    setLoading(true);
    setFeedback(null);

    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/device/approve`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${userId}`,
        },
        body: JSON.stringify({ user_code: code }),
      });

      if (!res.ok) {
        const error = await res.json();
        setFeedback({
          type: 'error',
          message: error.error || 'Approval failed',
        });
        return;
      }

      setFeedback({
        type: 'success',
        message: '✅ Login approved! Browser should now complete the flow.',
      });
      setChallengeDetails(null);
    } catch (err) {
      setFeedback({
        type: 'error',
        message: err instanceof Error ? err.message : 'Approval failed',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleDeny = async () => {
    if (!code) return;

    setLoading(true);
    setFeedback(null);

    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/device/deny`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${userId}`,
        },
        body: JSON.stringify({ user_code: code }),
      });

      if (!res.ok) {
        const error = await res.json();
        setFeedback({
          type: 'error',
          message: error.error || 'Deny failed',
        });
        return;
      }

      setFeedback({
        type: 'success',
        message: '✅ Login denied.',
      });
      setChallengeDetails(null);
    } catch (err) {
      setFeedback({
        type: 'error',
        message: err instanceof Error ? err.message : 'Deny failed',
      });
    } finally {
      setLoading(false);
    }
  };

  const feedbackColors = {
    success: 'bg-green-50 border-green-200 text-green-900',
    error: 'bg-red-50 border-red-200 text-red-900',
    info: 'bg-blue-50 border-blue-200 text-blue-900',
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-900 to-purple-800 p-4">
      <div className="max-w-md mx-auto">
        {/* Phone Frame */}
        <div className="bg-black rounded-3xl shadow-2xl p-3" style={{ aspectRatio: '9/18' }}>
          <div className="bg-white rounded-3xl h-full overflow-hidden flex flex-col">
            {/* Status Bar */}
            <div className="bg-black text-white text-xs p-2 flex justify-between items-center text-center rounded-t-2xl">
              <span>9:41</span>
              <span>📶 📡 🔋</span>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-6 flex flex-col">
              {/* Header */}
              <div className="mb-6">
                <div className="w-12 h-12 bg-purple-100 rounded-full flex items-center justify-center mx-auto mb-3">
                  📱
                </div>
                <h1 className="text-2xl font-bold text-center text-gray-900">Login Request</h1>
                <p className="text-center text-gray-600 text-sm mt-1">A device is requesting access</p>
              </div>

              {/* User ID Select */}
              <div className="mb-4">
                <label className="block text-xs font-semibold text-gray-700 mb-2">Sign in as</label>
                <select
                  value={userId}
                  onChange={(e) => setUserId(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                >
                  <option value="mobile-user-001">mobile-user-001</option>
                  <option value="mobile-user-002">mobile-user-002</option>
                  <option value="alice@example.com">alice@example.com</option>
                </select>
              </div>

              {/* Code Input */}
              <div className="mb-4">
                <label className="block text-xs font-semibold text-gray-700 mb-2">User Code</label>
                <input
                  type="text"
                  value={code}
                  onChange={(e) => handleScan(e.target.value)}
                  placeholder="ABCD-EFGH"
                  className="w-full px-3 py-3 border-2 border-gray-300 rounded-lg font-mono text-lg text-center tracking-widest uppercase font-bold"
                />
              </div>

              {/* Challenge Details */}
              {challengeDetails && (
                <div className="bg-blue-50 border-2 border-blue-200 rounded-lg p-4 mb-4 text-sm">
                  <p className="font-semibold text-blue-900 mb-2">Requester Info:</p>
                  <div className="space-y-1 text-blue-800 text-xs">
                    <p>🌐 {challengeDetails.requesterInfo?.userAgent || 'Unknown Browser'}</p>
                    <p>📍 {challengeDetails.requesterInfo?.ip || 'Unknown IP'}</p>
                    <p>🗺️ {challengeDetails.requesterInfo?.approxLocation || 'Unknown Location'}</p>
                  </div>
                </div>
              )}

              {/* Feedback */}
              {feedback && (
                <div className={`border-2 rounded-lg p-3 mb-4 text-sm font-semibold ${feedbackColors[feedback.type]}`}>
                  {feedback.message}
                </div>
              )}

              {/* Buttons */}
              {challengeDetails && (
                <div className="flex gap-2 mt-auto">
                  <button
                    onClick={handleDeny}
                    disabled={loading}
                    className="flex-1 bg-gray-500 hover:bg-gray-600 text-white font-semibold py-3 px-4 rounded-lg disabled:opacity-50 text-sm"
                  >
                    {loading ? '...' : '✗ Deny'}
                  </button>
                  <button
                    onClick={handleApprove}
                    disabled={loading}
                    className="flex-1 bg-green-600 hover:bg-green-700 text-white font-semibold py-3 px-4 rounded-lg disabled:opacity-50 text-sm"
                  >
                    {loading ? '...' : '✓ Approve'}
                  </button>
                </div>
              )}

              {!challengeDetails && code && !feedback && (
                <button
                  onClick={() => handleScan(code)}
                  disabled={loading}
                  className="w-full mt-auto bg-purple-600 hover:bg-purple-700 text-white font-semibold py-3 px-4 rounded-lg disabled:opacity-50"
                >
                  {loading ? 'Loading...' : 'Scan Code'}
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Instructions */}
        <div className="text-white text-center text-sm mt-6">
          <p>📱 Simulator: Paste the user code from the browser QR</p>
          <p className="text-xs text-purple-200 mt-2">Press approve to complete the login flow</p>
        </div>
      </div>
    </div>
  );
}
