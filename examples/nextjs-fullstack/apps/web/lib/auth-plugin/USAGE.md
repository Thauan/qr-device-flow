# Auth Plugin System - Usage Guide

A unified authentication system that decouples your application from specific auth providers. Easily swap between NextAuth, Auth0, Supabase, or implement custom providers.

## Quick Start

### 1. Wrap Your App with AuthProvider

In `app/layout.tsx` or any client component:

```tsx
import { AuthProvider } from '@/lib/auth-context';

export default function RootLayout({ children }) {
  return (
    <html>
      <body>
        <AuthProvider provider="nextauth">
          {children}
        </AuthProvider>
      </body>
    </html>
  );
}
```

### 2. Use the `useAuth` Hook

```tsx
'use client';

import { useAuth } from '@/lib/auth-context';

export default function MyComponent() {
  const { session, signIn, signOut, isLoading } = useAuth();

  if (isLoading) return <div>Loading...</div>;
  if (!session) return <div>Not authenticated</div>;

  return (
    <div>
      <p>Welcome {session.user?.name}</p>
      <button onClick={() => signOut()}>Sign Out</button>
    </div>
  );
}
```

## Available Providers

### NextAuth (`'nextauth'`)
Uses your existing Next-Auth.js setup. Compatible with the current `/lib/auth.ts` configuration.

```tsx
<AuthProvider provider="nextauth">
  <App />
</AuthProvider>
```

### Demo (`'demo'`)
Simple in-memory session storage for testing without auth infrastructure.

```tsx
<AuthProvider provider="demo">
  <App />
</AuthProvider>
```

### Auth0 (`'auth0'`)
Template for Auth0 integration. Skeleton provided, needs implementation.

```tsx
<AuthProvider provider="auth0">
  <App />
</AuthProvider>
```

## Switching Providers

Simply change the provider prop in `AuthProvider`:

```diff
- <AuthProvider provider="nextauth">
+ <AuthProvider provider="demo">
  <App />
</AuthProvider>
```

No other code changes needed! The plugin system handles all provider-specific logic.

## Creating a Custom Provider

Implement the `AuthPlugin` interface:

```typescript
import type { AuthPlugin, Session } from './index';

class MyCustomPlugin implements AuthPlugin {
  name = 'my-provider';

  async signIn(token: string): Promise<Session | null> {
    // Your sign-in logic here
    return { userId: 'user-1', user: { email: 'user@example.com' } };
  }

  async getSession(): Promise<Session | null> {
    // Your get-session logic here
    return null;
  }

  async signOut(): Promise<void> {
    // Your sign-out logic here
  }
}

export function createMyCustomPlugin(): AuthPlugin {
  return new MyCustomPlugin();
}
```

Then add it to the factory function in `index.ts`:

```typescript
export function createAuthPlugin(provider: AuthProvider): AuthPlugin {
  switch (provider) {
    case 'my-provider':
      return require('./my-custom-plugin').createMyCustomPlugin();
    // ... other cases
  }
}
```

## useAuth Hook API

### `session: Session | null`
The current authenticated session, or `null` if not authenticated.

```typescript
interface Session {
  userId: string;
  user?: {
    email?: string;
    name?: string;
    id?: string;
  };
  expiresAt?: number;
}
```

### `signIn(token: string): Promise<Session | null>`
Sign in with an access token from device authorization flow.

```typescript
const session = await signIn(accessToken);
if (session) {
  console.log('Logged in as:', session.userId);
}
```

### `signOut(): Promise<void>`
Sign out the current user.

```typescript
await signOut();
```

### `isLoading: boolean`
Whether authentication is being initialized.

```typescript
if (isLoading) return <div>Loading auth...</div>;
```

### `plugin: AuthPlugin`
Direct access to the underlying plugin instance (rarely needed).

```typescript
const providerName = plugin.name;
```

## Migration Guide

### From Direct NextAuth to Plugin System

**Before:**
```tsx
import { signIn } from 'next-auth/react';

const result = await signIn('credentials', {
  token: accessToken,
  redirect: false,
});
```

**After:**
```tsx
const { signIn } = useAuth();
const result = await signIn(accessToken);
```

## Testing with Demo Provider

For development and testing without full auth setup:

```tsx
<AuthProvider provider="demo">
  <App />
</AuthProvider>
```

The demo provider:
- Accepts any token
- Creates mock sessions
- Stores sessions in memory
- Clears on page refresh
- Simulates network delays (100-300ms)

## Implementing Auth0

See `auth0-plugin.ts` for the skeleton template with implementation notes.

To complete Auth0 implementation:

1. Install @auth0/nextjs-auth0
2. Set environment variables:
   - `AUTH0_DOMAIN`
   - `NEXT_PUBLIC_AUTH0_CLIENT_ID`
   - `AUTH0_CLIENT_SECRET` (server-side only)
   - `AUTH0_AUDIENCE` (if applicable)
3. Implement the TODO sections in `auth0-plugin.ts`

## Architecture

```
app/layout.tsx
  └── AuthProvider (provider="nextauth")
        └── auth-context.tsx (React Context)
              └── lib/auth-plugin/
                    ├── index.ts (interfaces & factory)
                    ├── nextauth-plugin.ts
                    ├── demo-plugin.ts
                    ├── auth0-plugin.ts
                    └── [your-custom-plugin].ts
```

### How It Works

1. **AuthProvider** wraps your app and initializes the auth plugin
2. **useAuth hook** provides access to session and auth methods
3. **Auth plugins** implement provider-specific logic
4. **Factory function** creates the right plugin based on provider name
5. **Consistent Session interface** makes providers interchangeable

## File Structure

```
lib/auth-plugin/
├── index.ts              # Main exports & interfaces
├── nextauth-plugin.ts    # NextAuth implementation
├── demo-plugin.ts        # Demo/test implementation
├── auth0-plugin.ts       # Auth0 skeleton/template
└── USAGE.md             # This file

lib/auth-context.tsx     # React context & useAuth hook
```

## Troubleshooting

### "useAuth must be used within an AuthProvider component"
Make sure your component is wrapped with AuthProvider higher in the component tree.

```tsx
// This won't work:
function App() {
  return <MyComponent />;  // MyComponent uses useAuth
}

// Do this instead:
function App() {
  return (
    <AuthProvider provider="nextauth">
      <MyComponent />
    </AuthProvider>
  );
}
```

### Session is always null
- Check that the auth provider is configured correctly
- Verify environment variables for your provider
- Check browser console for error messages

### Sessions clear on page refresh with demo provider
This is expected behavior. The demo provider uses in-memory storage. Use 'nextauth' for persistent sessions.

## Environment Variables

### NextAuth
- `NEXTAUTH_SECRET` - Secret for JWT signing
- `NEXTAUTH_URL` - Your app URL (production)

### Auth0
- `AUTH0_DOMAIN` - Your Auth0 domain
- `NEXT_PUBLIC_AUTH0_CLIENT_ID` - Auth0 client ID
- `AUTH0_CLIENT_SECRET` - Auth0 client secret
- `AUTH0_AUDIENCE` - Auth0 API identifier (optional)

### Custom Providers
Define as needed in your implementation.

## Best Practices

1. **Wrap at the root level** - Put AuthProvider in your root layout for app-wide access
2. **Use the hook, not the plugin** - Prefer `useAuth()` over direct plugin access
3. **Handle loading state** - Always check `isLoading` before rendering auth-dependent UI
4. **Implement error handling** - Check for null returns from `signIn()` and `signOut()`
5. **Keep plugins simple** - Each plugin should only handle its provider's logic
6. **Type-safe** - Use TypeScript to catch provider-specific issues at compile time

## Contributing

To add a new provider:

1. Copy `auth0-plugin.ts` as a template
2. Implement all methods of `AuthPlugin` interface
3. Add provider type to `AuthProvider` type in `index.ts`
4. Add case to factory function in `index.ts`
5. Update this documentation
6. Test with example app

## See Also

- `lib/auth-plugin/index.ts` - Core interfaces
- `lib/auth-context.tsx` - React context implementation
- `lib/auth-plugin/nextauth-plugin.ts` - Reference implementation
- Existing `lib/auth.ts` - NextAuth configuration (unchanged)
