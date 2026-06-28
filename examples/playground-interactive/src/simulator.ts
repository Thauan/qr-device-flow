/**
 * In-memory RFC 8628 state machine simulator for playground.
 * Simulates the full device authorization flow without backend.
 */

export type ChallengeStatus =
  | "pending"
  | "scanned"
  | "approved"
  | "denied"
  | "expired"
  | "approved-consumed";

export type ChallengeEvent =
  | "SCAN"
  | "APPROVE"
  | "DENY"
  | "CONSUME"
  | "EXPIRE";

export interface Challenge {
  deviceCode: string;
  userCode: string;
  status: ChallengeStatus;
  createdAt: number;
  expiresAt: number;
  userId?: string;
  requesterInfo: {
    userAgent: string;
    ip: string;
    approxLocation: string;
  };
}

export interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete: string;
  expires_in: number;
  interval: number;
}

export interface IssuedSession {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

// State machine
function transition(
  current: ChallengeStatus,
  event: ChallengeEvent
): ChallengeStatus | null {
  const transitions: Record<ChallengeStatus, Record<ChallengeEvent, ChallengeStatus>> = {
    pending: {
      SCAN: "scanned",
      APPROVE: "approved",
      DENY: "denied",
      CONSUME: null as any,
      EXPIRE: "expired",
    },
    scanned: {
      SCAN: "scanned",
      APPROVE: "approved",
      DENY: "denied",
      CONSUME: null as any,
      EXPIRE: "expired",
    },
    approved: {
      SCAN: null as any,
      APPROVE: null as any,
      DENY: null as any,
      CONSUME: "approved-consumed",
      EXPIRE: "expired",
    },
    denied: {
      SCAN: null as any,
      APPROVE: null as any,
      DENY: null as any,
      CONSUME: null as any,
      EXPIRE: null as any,
    },
    expired: {
      SCAN: null as any,
      APPROVE: null as any,
      DENY: null as any,
      CONSUME: null as any,
      EXPIRE: null as any,
    },
    "approved-consumed": {
      SCAN: null as any,
      APPROVE: null as any,
      DENY: null as any,
      CONSUME: null as any,
      EXPIRE: null as any,
    },
  };

  const next = transitions[current]?.[event];
  return next || null;
}

// Code generation (simplified for playground)
function generateDeviceCode(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let code = "";
  for (let i = 0; i < 43; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

function generateUserCode(): string {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // No 0/O/1/I/L
  let code = "";
  for (let i = 0; i < 8; i++) {
    code += alphabet[Math.floor(Math.random() * alphabet.length)];
    if (i === 3) code += "-";
  }
  return code;
}

// Storage
export class ChallengeStore {
  private challenges = new Map<string, Challenge>();
  private userCodeIndex = new Map<string, string>(); // userCode -> deviceCode

  createChallenge(requesterInfo: Challenge["requesterInfo"]): Challenge {
    const now = Date.now();
    const expiresIn = 120; // 2 minutes
    const challenge: Challenge = {
      deviceCode: generateDeviceCode(),
      userCode: generateUserCode(),
      status: "pending",
      createdAt: now,
      expiresAt: now + expiresIn * 1000,
      requesterInfo,
    };

    this.challenges.set(challenge.deviceCode, challenge);
    this.userCodeIndex.set(challenge.userCode, challenge.deviceCode);

    return challenge;
  }

  getByDeviceCode(deviceCode: string): Challenge | null {
    const challenge = this.challenges.get(deviceCode);
    if (!challenge) return null;

    // Check expiry
    if (Date.now() > challenge.expiresAt && challenge.status !== "approved-consumed") {
      challenge.status = "expired";
    }

    return challenge;
  }

  getByUserCode(userCode: string): Challenge | null {
    const deviceCode = this.userCodeIndex.get(userCode);
    if (!deviceCode) return null;
    return this.getByDeviceCode(deviceCode);
  }

  transitionChallenge(
    deviceCode: string,
    event: ChallengeEvent,
    userId?: string
  ): Challenge | null {
    const challenge = this.getByDeviceCode(deviceCode);
    if (!challenge) return null;

    const nextStatus = transition(challenge.status, event);
    if (!nextStatus) return null;

    challenge.status = nextStatus;
    if (event === "APPROVE" && userId) {
      challenge.userId = userId;
    }

    return challenge;
  }

  issueSession(deviceCode: string): IssuedSession | null {
    const challenge = this.getByDeviceCode(deviceCode);
    if (!challenge || challenge.status !== "approved") return null;

    return {
      access_token: `demo-token-${challenge.userId}-${Date.now()}`,
      refresh_token: `demo-refresh-${challenge.userId}`,
      expires_in: 3600,
    };
  }
}

// Public API
export class PlaygroundSimulator {
  private store = new ChallengeStore();
  private pollingIntervals = new Map<string, NodeJS.Timeout>();

  createChallenge(requesterInfo: Challenge["requesterInfo"]): DeviceCodeResponse {
    const challenge = this.store.createChallenge(requesterInfo);
    return {
      device_code: challenge.deviceCode,
      user_code: challenge.userCode,
      verification_uri: "http://localhost:3000/connect",
      verification_uri_complete: `http://localhost:3000/connect?user_code=${challenge.userCode}`,
      expires_in: 120,
      interval: 5,
    };
  }

  getStatus(deviceCode: string): { status: ChallengeStatus } | null {
    const challenge = this.store.getByDeviceCode(deviceCode);
    if (!challenge) return null;
    return { status: challenge.status };
  }

  scan(userCode: string): boolean {
    const challenge = this.store.getByUserCode(userCode);
    if (!challenge) return false;
    this.store.transitionChallenge(challenge.deviceCode, "SCAN");
    return true;
  }

  approve(userCode: string, userId: string): boolean {
    const challenge = this.store.getByUserCode(userCode);
    if (!challenge) return false;

    // Simulate optional SCAN step
    if (challenge.status === "pending") {
      this.store.transitionChallenge(challenge.deviceCode, "SCAN");
    }

    const result = this.store.transitionChallenge(
      challenge.deviceCode,
      "APPROVE",
      userId
    );
    return result !== null;
  }

  deny(userCode: string): boolean {
    const challenge = this.store.getByUserCode(userCode);
    if (!challenge) return false;

    // Simulate optional SCAN step
    if (challenge.status === "pending") {
      this.store.transitionChallenge(challenge.deviceCode, "SCAN");
    }

    const result = this.store.transitionChallenge(challenge.deviceCode, "DENY");
    return result !== null;
  }

  consume(deviceCode: string): IssuedSession | null {
    const challenge = this.store.getByDeviceCode(deviceCode);
    if (!challenge || challenge.status !== "approved") return null;

    const session = this.store.issueSession(deviceCode);
    if (session) {
      this.store.transitionChallenge(deviceCode, "CONSUME");
    }
    return session;
  }

  getChallenge(deviceCode: string): Challenge | null {
    return this.store.getByDeviceCode(deviceCode);
  }

  getByUserCode(userCode: string): Challenge | null {
    return this.store.getByUserCode(userCode);
  }

  // Simulate expiry
  startExpiryTimer(deviceCode: string, callback: () => void): void {
    const challenge = this.store.getByDeviceCode(deviceCode);
    if (!challenge) return;

    const timeout = setTimeout(() => {
      this.store.transitionChallenge(deviceCode, "EXPIRE");
      callback();
    }, challenge.expiresAt - Date.now());

    this.pollingIntervals.set(deviceCode, timeout);
  }

  cleanup(): void {
    this.pollingIntervals.forEach((timeout) => clearTimeout(timeout));
    this.pollingIntervals.clear();
  }
}

// Singleton instance
export const simulator = new PlaygroundSimulator();
