# @qr-device-flow/react-native

Mobile side of the [QR device flow](../../README.md): a client for the consent screen (`fetchChallengeDetails`, `approve`, `deny`), a React hook, and a camera scanner component.

```tsx
import { DeviceFlowMobileClient, QRScanner } from "@qr-device-flow/react-native";

const client = new DeviceFlowMobileClient({
  endpoint: "https://api.example.com/device",
  getAuthToken: () => session.accessToken, // the logged-in user's token
});

<QRScanner
  onScan={async (userCode) => {
    const details = await client.fetchChallengeDetails(userCode);
    // Show details.requesterInfo (browser, IP, location) on a consent screen.
    // Ask the user to type the two-digit number shown on the login screen.
    const number = await askUserForNumber();
    await client.approve(userCode, number); // or client.deny(userCode)
  }}
/>;
```

## Entry points

| Import | Contents |
|---|---|
| `@qr-device-flow/react-native` | Client, hook and `QRScanner` (needs `react-native` and `expo-camera`) |
| `@qr-device-flow/react-native/client` | Client and types only, with no native dependencies. Works in any JS runtime |

## Notes

- There is no auto-approve. The consent screen is part of the flow.
- `approve` needs the verification number shown on the browser. A wrong number is rejected, and three wrong numbers deny the login.
- `scan`, `approve` and `deny` send the auth token as `Authorization: Bearer`. The server decides who the user is.
