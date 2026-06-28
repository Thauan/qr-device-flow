import React, { useEffect, useState, useRef } from "react";
import QRCode from "qrcode";
import { simulator, ChallengeStatus, Challenge } from "./simulator";

// ─────────────────────────────────────────────────────────────────────
// BROWSER SIDE
// ─────────────────────────────────────────────────────────────────────

interface BrowserPanelProps {
  onDeviceCodeCreated: (deviceCode: string) => void;
}

export function BrowserPanel({ onDeviceCodeCreated }: BrowserPanelProps) {
  const [qrSvg, setQrSvg] = useState<string>("");
  const [userCode, setUserCode] = useState<string>("");
  const [status, setStatus] = useState<ChallengeStatus>("pending");
  const [expiresIn, setExpiresIn] = useState<number>(120);
  const [session, setSession] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>("");
  const deviceCodeRef = useRef<string>("");
  const countdownRef = useRef<NodeJS.Timeout | null>(null);
  const pollingRef = useRef<NodeJS.Timeout | null>(null);

  const startFlow = async () => {
    setLoading(true);
    setError("");
    setSession(null);

    try {
      console.log("🚀 Starting flow, creating challenge...");
      const response = simulator.createChallenge({
        userAgent: "Chrome/125 (Playground)",
        ip: "192.168.1.100",
        approxLocation: "São Paulo, BR",
      });

      deviceCodeRef.current = response.device_code;
      setUserCode(response.user_code);
      setExpiresIn(response.expires_in);
      onDeviceCodeCreated(response.device_code);

      // Generate QR code
      const svg = await QRCode.toString(response.verification_uri_complete, {
        type: "image/svg+xml",
        margin: 1,
        color: { dark: "#1a1b23", light: "#ffffff" },
        width: 220,
      });
      setQrSvg(svg);

      // Start countdown and polling
      startCountdown(response.expires_in);
      startPolling(response.device_code);

      // Setup expiry
      simulator.startExpiryTimer(response.device_code, () => {
        setStatus("expired");
        stopPolling();
        stopCountdown();
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create challenge");
    } finally {
      setLoading(false);
    }
  };

  const startCountdown = (seconds: number) => {
    let remaining = seconds;
    setExpiresIn(remaining);

    if (countdownRef.current) clearInterval(countdownRef.current);

    countdownRef.current = setInterval(() => {
      remaining--;
      setExpiresIn(remaining);

      if (remaining <= 0) {
        stopCountdown();
        if (status === "pending" || status === "scanned") {
          setStatus("expired");
        }
      }
    }, 1000);
  };

  const startPolling = (deviceCode: string) => {
    if (pollingRef.current) clearInterval(pollingRef.current);

    const poll = () => {
      const statusResp = simulator.getStatus(deviceCode);
      if (!statusResp) {
        setError("Challenge not found");
        return;
      }

      setStatus(statusResp.status);

      if (statusResp.status === "approved") {
        stopPolling();
        consumeChallenge(deviceCode);
      } else if (statusResp.status === "denied") {
        stopPolling();
      } else if (statusResp.status === "expired") {
        stopPolling();
      }
    };

    // Poll every 2 seconds for demo (RFC 8628 recommends 5)
    pollingRef.current = setInterval(poll, 2000);
    poll(); // Immediate first poll
  };

  const consumeChallenge = (deviceCode: string) => {
    console.log("🔍 Consuming challenge:", deviceCode);
    const sessionResp = simulator.consume(deviceCode);
    console.log("📊 Session response:", sessionResp);
    if (sessionResp) {
      setSession(sessionResp);
      setStatus("approved-consumed");
      console.log("✅ Session set successfully");
    } else {
      setError("Failed to consume challenge");
      console.error("❌ Failed to consume challenge");
    }
  };

  const stopCountdown = () => {
    if (countdownRef.current) {
      clearInterval(countdownRef.current);
      countdownRef.current = null;
    }
  };

  const stopPolling = () => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
  };

  const reset = () => {
    stopCountdown();
    stopPolling();
    simulator.cleanup();
    setQrSvg("");
    setUserCode("");
    setStatus("pending");
    setExpiresIn(120);
    setSession(null);
    setError("");
    deviceCodeRef.current = "";
  };

  useEffect(() => {
    return () => {
      stopCountdown();
      stopPolling();
    };
  }, []);

  const statusColors: Record<ChallengeStatus, string> = {
    pending: "bg-blue-100 text-blue-900",
    scanned: "bg-blue-100 text-blue-900",
    approved: "bg-green-100 text-green-900",
    denied: "bg-red-100 text-red-900",
    expired: "bg-gray-100 text-gray-900",
    "approved-consumed": "bg-green-100 text-green-900",
  };

  const minutes = Math.floor(expiresIn / 60);
  const seconds = expiresIn % 60;

  return (
    <div className="bg-gradient-to-br from-white/95 to-gray-50/95 backdrop-blur-xl rounded-2xl shadow-2xl p-8 border border-white/20">
      <div className="flex items-center gap-3 mb-6">
        <div className="text-3xl">🌐</div>
        <h2 className="text-3xl font-bold text-gray-900">Browser Login</h2>
      </div>

      {!session && !error && (
        <>
          {qrSvg && status !== "approved-consumed" ? (
            <div className="space-y-4">
              <div className="bg-gradient-to-br from-white to-gray-50 p-6 rounded-2xl border-2 border-purple-200 inline-block shadow-lg hover:shadow-xl transition-shadow">
                <div className="bg-white p-2 rounded-lg" dangerouslySetInnerHTML={{ __html: qrSvg }} />
                <p className="text-xs text-center text-gray-500 mt-2 font-semibold">Scan with your phone</p>
              </div>

              <div className="text-center">
                <p className="text-sm text-gray-600 mb-2">User Code (fallback)</p>
                <p className="text-3xl font-mono font-bold text-purple-600 tracking-widest">
                  {userCode}
                </p>
              </div>

              <div className="text-sm text-gray-600">
                Expires in {minutes}:{seconds.toString().padStart(2, "0")}
              </div>

              <div className={`p-4 rounded-xl border-2 ${statusColors[status]} backdrop-blur`}>
                <p className="font-bold text-lg">
                  {status === "pending" && "⏳ Waiting for scan..."}
                  {status === "scanned" && "📱 Phone detected! Confirm on your device..."}
                  {status === "approved" && "✅ Approved! Consuming session..."}
                  {status === "denied" && "❌ Denied on mobile"}
                  {status === "expired" && "⏰ Session expired"}
                </p>
              </div>

              {(status === "denied" || status === "expired") && (
                <button
                  onClick={reset}
                  className="w-full bg-gradient-to-r from-gray-600 to-gray-700 hover:from-gray-700 hover:to-gray-800 text-white font-bold py-3 px-4 rounded-xl transition-all transform hover:scale-105 active:scale-95"
                >
                  🔄 Try Again
                </button>
              )}
            </div>
          ) : (
            <button
              onClick={startFlow}
              disabled={loading}
              className="w-full bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 text-white font-bold py-4 px-6 rounded-xl disabled:opacity-50 transition-all transform hover:scale-105 active:scale-95 shadow-lg"
            >
              {loading ? "⏳ Creating challenge..." : "🎯 Start QR Login"}
            </button>
          )}
        </>
      )}

      {session && (
        <div className="bg-gradient-to-br from-green-50 to-emerald-50 border-2 border-green-300 rounded-xl p-6">
          <h3 className="font-bold text-green-900 mb-3 text-lg">🎉 Session Issued Successfully</h3>
          <pre className="bg-white p-4 rounded-lg text-xs overflow-auto max-h-48 border border-green-200">
            {JSON.stringify(session, null, 2)}
          </pre>
        </div>
      )}

      {error && (
        <div className="bg-gradient-to-br from-red-50 to-rose-50 border-2 border-red-300 rounded-xl p-6">
          <p className="text-red-900 font-semibold text-sm">⚠️ {error}</p>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// MOBILE SIDE
// ─────────────────────────────────────────────────────────────────────

interface MobilePanelProps {
  deviceCode: string;
}

export function MobilePanel({ deviceCode }: MobilePanelProps) {
  const [userCode, setUserCode] = useState<string>("");
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [userId, setUserId] = useState<string>("demo-user-001");
  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState<string>("");
  const [feedbackType, setFeedbackType] = useState<"success" | "error" | "info">("info");

  const handleScan = (code: string) => {
    const normalized = code.toUpperCase().replace(/\s/g, "");
    setUserCode(normalized);
    console.log("📱 Mobile scanning code:", normalized);

    const ch = simulator.getByUserCode(normalized);
    console.log("📱 Challenge found:", ch);
    if (ch) {
      setChallenge(ch);
      setFeedbackType("info");
      setFeedback(`✓ Found challenge: ${code}`);
    } else {
      setFeedback("❌ Invalid code");
      setFeedbackType("error");
    }
  };

  const handleApprove = async () => {
    if (!userCode) return;

    setLoading(true);
    try {
      const success = simulator.approve(userCode, userId);
      if (success) {
        setFeedbackType("success");
        setFeedback("✅ Login approved!");
      } else {
        setFeedbackType("error");
        setFeedback("❌ Approval failed");
      }
    } finally {
      setLoading(false);
    }
  };

  const handleDeny = async () => {
    if (!userCode) return;

    setLoading(true);
    try {
      const success = simulator.deny(userCode);
      if (success) {
        setFeedbackType("success");
        setFeedback("✅ Login denied");
      } else {
        setFeedbackType("error");
        setFeedback("❌ Deny failed");
      }
    } finally {
      setLoading(false);
    }
  };

  const statusColors: Record<ChallengeStatus, string> = {
    pending: "bg-blue-50 border-blue-200",
    scanned: "bg-blue-50 border-blue-200",
    approved: "bg-green-50 border-green-200",
    denied: "bg-red-50 border-red-200",
    expired: "bg-gray-50 border-gray-200",
    "approved-consumed": "bg-green-50 border-green-200",
  };

  return (
    <div className="bg-gradient-to-br from-white/95 to-gray-50/95 backdrop-blur-xl rounded-2xl shadow-2xl p-8 border border-white/20">
      <div className="flex items-center gap-3 mb-6">
        <div className="text-3xl">📱</div>
        <h2 className="text-3xl font-bold text-gray-900">Mobile Simulator</h2>
      </div>

      <div className="space-y-4">
        {/* Code Input */}
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-2">
            Scan or Enter Code
          </label>
          <input
            type="text"
            value={userCode}
            onChange={(e) => handleScan(e.target.value)}
            placeholder="ABCD-EFGH"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg font-mono text-lg text-center tracking-widest uppercase"
          />
        </div>

        {/* User ID */}
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-2">
            Sign in as
          </label>
          <select
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
          >
            <option value="demo-user-001">demo-user-001</option>
            <option value="demo-user-002">demo-user-002</option>
            <option value="alice@example.com">alice@example.com</option>
            <option value="bob@example.com">bob@example.com</option>
          </select>
        </div>

        {/* Challenge Details */}
        {challenge && (
          <div className={`border-2 rounded-lg p-4 ${statusColors[challenge.status]}`}>
            <p className="text-sm font-semibold text-gray-700 mb-2">Requester Info</p>
            <div className="text-xs text-gray-600 space-y-1">
              <p>🌐 {challenge.requesterInfo.userAgent}</p>
              <p>📍 {challenge.requesterInfo.ip}</p>
              <p>🗺️ {challenge.requesterInfo.approxLocation}</p>
            </div>

            <hr className="my-3" />

            <p className="text-xs text-gray-600 mb-2">
              Status: <span className="font-semibold uppercase">{challenge.status}</span>
            </p>

            {/* Action Buttons */}
            {challenge.status === "pending" || challenge.status === "scanned" ? (
              <div className="flex gap-3 mt-4">
                <button
                  onClick={handleDeny}
                  disabled={loading}
                  className="flex-1 bg-gradient-to-r from-gray-600 to-gray-700 hover:from-gray-700 hover:to-gray-800 text-white font-bold py-3 px-4 rounded-lg disabled:opacity-50 text-sm transition-all transform hover:scale-105 active:scale-95"
                >
                  {loading ? "..." : "✗ Deny"}
                </button>
                <button
                  onClick={handleApprove}
                  disabled={loading}
                  className="flex-1 bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700 text-white font-bold py-3 px-4 rounded-lg disabled:opacity-50 text-sm transition-all transform hover:scale-105 active:scale-95"
                >
                  {loading ? "..." : "✓ Approve"}
                </button>
              </div>
            ) : (
              <div className="text-sm font-bold text-gray-900 p-3 bg-gradient-to-r from-gray-100 to-gray-50 rounded-lg text-center border border-gray-200 mt-4">
                {challenge.status === "approved" && "✅ Approved"}
                {challenge.status === "denied" && "❌ Denied"}
                {challenge.status === "expired" && "⏰ Expired"}
                {challenge.status === "approved-consumed" && "🎉 Consumed"}
              </div>
            )}
          </div>
        )}

        {/* Feedback */}
        {feedback && (
          <div
            className={`p-4 rounded-lg text-sm font-bold ${
              feedbackType === "success"
                ? "bg-gradient-to-r from-green-50 to-emerald-50 text-green-900 border-2 border-green-300"
                : feedbackType === "error"
                  ? "bg-gradient-to-r from-red-50 to-rose-50 text-red-900 border-2 border-red-300"
                  : "bg-gradient-to-r from-blue-50 to-cyan-50 text-blue-900 border-2 border-blue-300"
            }`}
          >
            {feedback}
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// MAIN APP
// ─────────────────────────────────────────────────────────────────────

export function PlaygroundApp() {
  const [deviceCode, setDeviceCode] = useState<string>("");

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-950 via-purple-900 to-slate-900 p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-12 text-center">
          <div className="mb-4 text-6xl">🔐</div>
          <h1 className="text-5xl font-black text-transparent bg-clip-text bg-gradient-to-r from-purple-400 via-pink-400 to-purple-400 mb-3">
            QR Device Flow
          </h1>
          <p className="text-xl text-gray-300 mb-2">
            Interactive RFC 8628 Device Authorization Grant
          </p>
          <p className="text-sm text-gray-400">
            No backend required • Open both panels side-by-side • 120 second timeout
          </p>
        </div>

        {/* Panels */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-8">
          <div className="transform transition-all hover:scale-[1.02]">
            <BrowserPanel onDeviceCodeCreated={setDeviceCode} />
          </div>
          {deviceCode && (
            <div className="transform transition-all hover:scale-[1.02]">
              <MobilePanel deviceCode={deviceCode} />
            </div>
          )}
        </div>

        {/* Protocol Flow */}
        <div className="mt-12 bg-gradient-to-br from-slate-900/80 to-slate-800/80 backdrop-blur-xl rounded-2xl shadow-2xl p-8 border border-purple-500/20">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-3 h-3 bg-gradient-to-r from-purple-400 to-pink-400 rounded-full animate-pulse"></div>
            <h3 className="text-2xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-pink-400">
              RFC 8628 State Machine
            </h3>
          </div>
          <pre className="text-xs text-gray-300 overflow-x-auto font-mono bg-slate-950/50 p-4 rounded-lg border border-purple-500/10">
{`┌─ pending ──SCAN──→ scanned ──APPROVE──→ approved ──CONSUME──→ approved-consumed
│      │                 │                      │
│      │                 └──DENY──→ denied      │
│      │                                         │
└──────└──EXPIRE──→ expired ◀──(TTL elapsed)────┘

✓ Browser creates challenge via POST /device/code
✓ Mobile scans QR code (optional SCAN event)
✓ Mobile shows requesterInfo, user approves
✓ Browser polls status, sees APPROVED
✓ Browser consumes session via POST /device/consume
✓ Both get tokens (single-use atomic transaction)`}
          </pre>
        </div>

        {/* Footer Info */}
        <div className="mt-12 grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-gradient-to-br from-blue-500/10 to-blue-600/5 backdrop-blur rounded-lg p-4 border border-blue-500/20">
            <div className="text-2xl mb-2">🌐</div>
            <p className="text-sm font-semibold text-blue-200">Browser Client</p>
            <p className="text-xs text-gray-400 mt-1">Creates QR code, polls status, consumes token</p>
          </div>
          <div className="bg-gradient-to-br from-purple-500/10 to-purple-600/5 backdrop-blur rounded-lg p-4 border border-purple-500/20">
            <div className="text-2xl mb-2">📱</div>
            <p className="text-sm font-semibold text-purple-200">Mobile App</p>
            <p className="text-xs text-gray-400 mt-1">Scans QR, shows consent, approves/denies</p>
          </div>
          <div className="bg-gradient-to-br from-pink-500/10 to-pink-600/5 backdrop-blur rounded-lg p-4 border border-pink-500/20">
            <div className="text-2xl mb-2">🔑</div>
            <p className="text-sm font-semibold text-pink-200">Authentication</p>
            <p className="text-xs text-gray-400 mt-1">Single-use tokens, no passwords needed</p>
          </div>
        </div>
      </div>
    </div>
  );
}
