# @qr-device-flow/storage-redis

Redis storage for [QR device flow](../../README.md) challenges. Records use Redis TTLs, and status changes are atomic (a Lua compare-and-swap script). A challenge can be consumed only once, even under concurrent requests.

```ts
import Redis from "ioredis";
import { DeviceFlowServer } from "@qr-device-flow/server";
import { RedisStorage } from "@qr-device-flow/storage-redis";

const redis = new Redis(process.env.REDIS_URL!);
const server = new DeviceFlowServer({
  storage: new RedisStorage({ redis, prefix: "qrdf:" }),
  verificationUri: "https://app.example.com/connect",
  issueSession: async ({ userId }) => ({ accessToken: `token-for-${userId}` }),
});
```

Requirements: `ioredis` 5 or newer (a peer dependency). Redis 6 or newer.

The package is tested against a real Redis when `REDIS_URL` is set (`pnpm test` skips those tests otherwise).
