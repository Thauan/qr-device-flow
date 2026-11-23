# @qr-device-flow/react-native

## 0.1.1

### Patch Changes

- 331fca5: Fix: the root entry failed to bundle in React Native apps. `QRScanner` lazy-required `expo-camera`, and the build turned that into a Node `createRequire` import, which Metro rejects. It now imports `CameraView` statically, so `expo-camera` is a required peer dependency of the root entry. The `/client` subpath is unchanged.
