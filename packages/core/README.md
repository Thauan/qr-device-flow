# @qr-device-flow/core

Protocol kernel for [QR device flow](../../README.md): types, constants, the challenge state machine and code generators. No I/O and no framework dependencies.

It is split into two entry points, so browser and mobile bundles never include server logic:

- `@qr-device-flow/core`: types and constants only. Safe for any bundle.
- `@qr-device-flow/core/server`: adds `transition`, the code generators and validation.

Most applications don't import this package directly. It is a dependency of `@qr-device-flow/server`, `@qr-device-flow/web`, `@qr-device-flow/react-native` and `@qr-device-flow/storage-redis`.

The wire protocol is documented in [PROTOCOL.md](../../PROTOCOL.md). The threat model is in [THREAT_MODEL.md](../../THREAT_MODEL.md).
