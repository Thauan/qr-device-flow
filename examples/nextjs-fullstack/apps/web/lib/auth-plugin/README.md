# Authentication Plugin System

A provider-agnostic authentication system for the QR Device Flow Next.js demo. Easily swap between NextAuth, Auth0, Supabase, and other auth providers without changing application logic.

## Quick Start

### 1. App is Already Configured

The app is pre-configured to use NextAuth in `app/layout.tsx`:

```tsx
<AuthProvider provider="nextauth">
  {children}
</AuthProvider>
```

### 2. Use the useAuth Hook

```tsx
'use client';
import { useAuth } from '@/lib/auth-context';

export default function Component() {
  const { session, signIn, signOut, isLoading } = useAuth();

  if (isLoading) return <div>Loading...</div>;
  
  return (
    <div>
      {session ? (
        <>
          Welcome {session.user?.name}
          <button onClick={() => signOut()}>Sign Out</button>
        </>
      ) : (
        <div>Not authenticated</div>
      )}
    </div>
  );
}
```

### 3. Switch Providers (Just Change One Line)

In `app/layout.tsx`:

```diff
- <AuthProvider provider="nextauth">
+ <AuthProvider provider="demo">
  {children}
</AuthProvider>
```

## Files in This Directory

| File | Purpose | Status |
|------|---------|--------|
| `index.ts` | Core interfaces and factory | ✓ Complete |
| `nextauth-plugin.ts` | NextAuth implementation | ✓ Complete |
| `demo-plugin.ts` | Demo/testing implementation | ✓ Complete |
| `auth0-plugin.ts` | Auth0 template | ✓ Template |
| `USAGE.md` | Comprehensive usage guide | ✓ Included |
| `EXTENDING.md` | Guide to adding new providers | ✓ Included |
| `README.md` | This file | ✓ You are here |

## Supported Providers

### NextAuth (Default)
Uses your existing NextAuth configuration from `/lib/auth.ts`.

**Status**: Production-ready  
**Use when**: You're using NextAuth.js  
**Provider value**: `'nextauth'`

### Demo
In-memory session storage. Great for testing without auth infrastructure.

**Status**: Production-ready  
**Use when**: Testing or development  
**Provider value**: `'demo'`  
**Note**: Sessions clear on page refresh

### Auth0
Skeleton/template provided. Shows how to extend for other providers.

**Status**: Template/skeleton  
**Use when**: You want to integrate Auth0  
**Provider value**: `'auth0'`  
**Next steps**: See `EXTENDING.md` for implementation

## Core Concepts

### AuthPlugin Interface
Every provider implements this:

```typescript
interface AuthPlugin {
  name: string;
  signIn(token: string): Promise<Session | null>;
  getSession(): Promise<Session | null>;
  signOut(): Promise<void>;
}
```

### Session Interface
Standard session format across all providers:

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

### AuthProvider Component
Wraps your app and provides auth context:

```tsx
<AuthProvider provider="nextauth">
  {children}
</AuthProvider>
```

### useAuth Hook
Access auth state and methods in any component:

```typescript
const { session, signIn, signOut, isLoading, plugin } = useAuth();
```

## Architecture

```
Your Component
  ↓ uses
useAuth() Hook
  ↓
AuthProvider + React Context
  ↓ creates
Auth Plugin (nextauth, demo, auth0, etc.)
  ↓
External Auth Service
```

## Common Tasks

### Check if User is Logged In
```tsx
const { session } = useAuth();
if (session) {
  // User is logged in
}
```

### Sign In with Token
```tsx
const { signIn } = useAuth();
const session = await signIn(accessToken);
```

### Sign Out
```tsx
const { signOut } = useAuth();
await signOut();
```

### Get User Email
```tsx
const { session } = useAuth();
const email = session?.user?.email;
```

### Handle Loading State
```tsx
const { isLoading } = useAuth();
if (isLoading) return <LoadingSpinner />;
```

## Adding a New Provider

1. **Create plugin file** (e.g., `supabase-plugin.ts`)
2. **Implement AuthPlugin interface** with your provider's logic
3. **Add to factory function** in `index.ts`
4. **Update AuthProvider type** to include new provider name
5. **Use it** by changing the provider prop in `AuthProvider`

See `EXTENDING.md` for detailed instructions and examples.

## Testing Different Providers

### Test with NextAuth (default)
```tsx
<AuthProvider provider="nextauth">
  <App />
</AuthProvider>
```

### Test with Demo Provider (no server needed)
```tsx
<AuthProvider provider="demo">
  <App />
</AuthProvider>
```

Then sign in with any token:
```tsx
const { signIn } = useAuth();
await signIn('test-token');
```

## Why This Architecture?

- **Decoupled**: App logic doesn't know about auth providers
- **Testable**: Easy to test with demo provider
- **Extendable**: Simple to add new providers
- **Maintainable**: Provider-specific code is isolated
- **Type-safe**: Full TypeScript support
- **Familiar**: Uses React Context pattern

## Existing Code Compatibility

- **auth.ts** - Unchanged, still works with NextAuth
- **[...nextauth]/route.ts** - Unchanged, NextAuth API route works
- **SessionProvider** - Replaced with AuthProvider, backward compatible

## What Changed

### Before
```tsx
// In login/page.tsx
import { signIn } from 'next-auth/react';
const result = await signIn('credentials', {
  token: accessToken,
  redirect: false,
});
```

### After
```tsx
// In login/page.tsx
const { signIn } = useAuth();
const result = await signIn(accessToken);
```

Benefits:
- Cleaner API
- Provider-agnostic
- Easier to test
- Type-safe

## Environment Variables

**NextAuth:**
- `NEXTAUTH_SECRET` - JWT signing secret
- `NEXTAUTH_URL` - App URL (production)

**Auth0:**
- `AUTH0_DOMAIN` - Auth0 domain
- `NEXT_PUBLIC_AUTH0_CLIENT_ID` - Auth0 client ID
- `AUTH0_CLIENT_SECRET` - Auth0 client secret

**Custom providers:**
- Define as needed in implementation

## Error Handling

All plugin methods return:
- `Session` on success
- `null` on error
- No exceptions thrown

Always check for null:
```tsx
const session = await signIn(token);
if (!session) {
  // Handle error
}
```

## Debugging

Enable debug logging by checking browser console:

```tsx
// Check current session
const { session } = useAuth();
console.log('Current session:', session);

// Check plugin name
const { plugin } = useAuth();
console.log('Auth provider:', plugin.name);
```

## Documentation

- **USAGE.md** - Comprehensive usage guide with examples
- **EXTENDING.md** - Guide for creating custom providers
- **Inline JSDoc** - Every export has detailed comments

## Next Steps

1. Read `USAGE.md` for detailed usage guide
2. Check `EXTENDING.md` if adding a new provider
3. See `login/page.tsx` for integration example
4. Review `auth-context.tsx` for implementation details

## Support

- Check `USAGE.md` for troubleshooting
- See `EXTENDING.md` for extension examples
- Review `nextauth-plugin.ts` for reference implementation
