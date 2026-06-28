# Extending the Auth Plugin System

This guide explains how to create a new authentication provider plugin.

## Interface Overview

All auth plugins must implement the `AuthPlugin` interface:

```typescript
export interface AuthPlugin {
  name: string;
  signIn(token: string): Promise<Session | null>;
  getSession(): Promise<Session | null>;
  signOut(): Promise<void>;
}

export interface Session {
  userId: string;
  user?: {
    email?: string;
    name?: string;
    id?: string;
  };
  expiresAt?: number;
}
```

## Step-by-Step Guide

### 1. Create Plugin File

Create a new file following the naming convention: `{provider}-plugin.ts`

```typescript
// lib/auth-plugin/supabase-plugin.ts

import type { AuthPlugin, Session } from './index';

class SupabasePlugin implements AuthPlugin {
  name = 'supabase';

  async signIn(token: string): Promise<Session | null> {
    // Implementation here
  }

  async getSession(): Promise<Session | null> {
    // Implementation here
  }

  async signOut(): Promise<void> {
    // Implementation here
  }
}

export function createSupabasePlugin(): AuthPlugin {
  return new SupabasePlugin();
}
```

### 2. Implement `signIn` Method

This method receives a token from the device authorization flow and creates a session.

```typescript
async signIn(token: string): Promise<Session | null> {
  if (!token) {
    return null;
  }

  try {
    // 1. Validate/verify the token with your provider
    const userInfo = await verifyTokenWithProvider(token);

    // 2. Extract user information
    if (!userInfo) {
      return null;
    }

    // 3. Create and return session in standard format
    return {
      userId: userInfo.id,
      user: {
        email: userInfo.email,
        name: userInfo.name,
        id: userInfo.id,
      },
      expiresAt: userInfo.expiresAt || Date.now() + 24 * 60 * 60 * 1000,
    };
  } catch (error) {
    console.error('Sign in error:', error);
    return null;
  }
}
```

### 3. Implement `getSession` Method

This method retrieves the current session from your provider.

```typescript
async getSession(): Promise<Session | null> {
  try {
    // 1. Fetch session from your provider
    const providerSession = await fetchSessionFromProvider();

    if (!providerSession) {
      return null;
    }

    // 2. Check if session is still valid
    if (isSessionExpired(providerSession)) {
      return null;
    }

    // 3. Convert provider format to standard Session format
    return {
      userId: providerSession.user.id,
      user: {
        email: providerSession.user.email,
        name: providerSession.user.name,
        id: providerSession.user.id,
      },
      expiresAt: providerSession.expiresAt,
    };
  } catch (error) {
    console.error('Get session error:', error);
    return null;
  }
}
```

### 4. Implement `signOut` Method

This method clears the session.

```typescript
async signOut(): Promise<void> {
  try {
    // 1. Clear session with your provider
    await clearSessionWithProvider();

    // 2. Clean up any client-side storage if needed
    localStorage.removeItem('provider-token');
  } catch (error) {
    console.error('Sign out error:', error);
    // Still consider sign out successful
    // The user is no longer authenticated regardless of errors
  }
}
```

### 5. Register in Factory Function

Add your provider to the `createAuthPlugin` factory function in `index.ts`:

```typescript
// lib/auth-plugin/index.ts

export type AuthProvider = 'nextauth' | 'auth0' | 'supabase' | 'demo';

export function createAuthPlugin(provider: AuthProvider): AuthPlugin {
  switch (provider) {
    case 'nextauth':
      return require('./nextauth-plugin').createNextAuthPlugin();
    case 'demo':
      return require('./demo-plugin').createDemoPlugin();
    case 'auth0':
      return require('./auth0-plugin').createAuth0Plugin();
    case 'supabase':  // ADD THIS
      return require('./supabase-plugin').createSupabasePlugin();
    default:
      throw new Error(`Unknown authentication provider: ${provider}`);
  }
}
```

### 6. Update Type Definitions

Update the `AuthProvider` type to include your new provider:

```typescript
export type AuthProvider = 'nextauth' | 'auth0' | 'supabase' | 'demo' | 'my-provider';
```

### 7. Test Your Plugin

```typescript
// Example test
const plugin = createAuthPlugin('supabase');

// Test sign in
const session = await plugin.signIn('test-token');
console.assert(session !== null, 'Sign in failed');
console.assert(session?.userId === 'expected-id', 'User ID mismatch');

// Test get session
const currentSession = await plugin.getSession();
console.assert(currentSession !== null, 'Get session failed');

// Test sign out
await plugin.signOut();
const afterSignOut = await plugin.getSession();
console.assert(afterSignOut === null, 'Sign out failed');
```

## Real-World Examples

### Supabase Example

```typescript
import { createClient } from '@supabase/supabase-js';
import type { AuthPlugin, Session } from './index';

class SupabasePlugin implements AuthPlugin {
  name = 'supabase';
  private supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  async signIn(token: string): Promise<Session | null> {
    try {
      const { data, error } = await this.supabase.auth.setSession({
        access_token: token,
        refresh_token: '', // Handle refresh token if available
      });

      if (error || !data.user) {
        return null;
      }

      return {
        userId: data.user.id,
        user: {
          email: data.user.email,
          name: data.user.user_metadata?.name,
          id: data.user.id,
        },
        expiresAt: data.session?.expires_at ? data.session.expires_at * 1000 : undefined,
      };
    } catch (error) {
      console.error('Supabase signIn error:', error);
      return null;
    }
  }

  async getSession(): Promise<Session | null> {
    try {
      const { data, error } = await this.supabase.auth.getSession();

      if (error || !data.session?.user) {
        return null;
      }

      return {
        userId: data.session.user.id,
        user: {
          email: data.session.user.email,
          name: data.session.user.user_metadata?.name,
          id: data.session.user.id,
        },
        expiresAt: data.session.expires_at ? data.session.expires_at * 1000 : undefined,
      };
    } catch (error) {
      console.error('Supabase getSession error:', error);
      return null;
    }
  }

  async signOut(): Promise<void> {
    try {
      await this.supabase.auth.signOut();
    } catch (error) {
      console.error('Supabase signOut error:', error);
    }
  }
}

export function createSupabasePlugin(): AuthPlugin {
  return new SupabasePlugin();
}
```

### Clerk Example

```typescript
import { useAuth } from '@clerk/nextjs';
import type { AuthPlugin, Session } from './index';

class ClerkPlugin implements AuthPlugin {
  name = 'clerk';

  async signIn(token: string): Promise<Session | null> {
    try {
      // Clerk uses a different flow - typically via Clerk's UI
      // This is an example of how you might integrate a custom token
      const response = await fetch('/api/clerk/verify-token', {
        method: 'POST',
        body: JSON.stringify({ token }),
      });

      if (!response.ok) {
        return null;
      }

      const user = await response.json();
      return {
        userId: user.id,
        user: {
          email: user.email,
          name: user.name,
          id: user.id,
        },
      };
    } catch (error) {
      console.error('Clerk signIn error:', error);
      return null;
    }
  }

  async getSession(): Promise<Session | null> {
    try {
      // Use Clerk's useAuth hook in a server context
      const response = await fetch('/api/clerk/session');
      if (!response.ok) {
        return null;
      }

      const user = await response.json();
      if (!user) {
        return null;
      }

      return {
        userId: user.id,
        user: {
          email: user.email,
          name: user.name,
          id: user.id,
        },
      };
    } catch (error) {
      console.error('Clerk getSession error:', error);
      return null;
    }
  }

  async signOut(): Promise<void> {
    try {
      await fetch('/api/clerk/signout', { method: 'POST' });
    } catch (error) {
      console.error('Clerk signOut error:', error);
    }
  }
}

export function createClerkPlugin(): AuthPlugin {
  return new ClerkPlugin();
}
```

## Best Practices

1. **Error Handling**: Always wrap provider calls in try-catch
2. **Type Conversion**: Map provider-specific types to standard Session format
3. **Token Validation**: Verify tokens before creating sessions
4. **Session Expiry**: Always return `expiresAt` if available
5. **Logging**: Use console.error for debugging, not console.log
6. **No Side Effects**: Keep plugin methods pure (except for auth state)
7. **Environment Variables**: Use `process.env` for sensitive config
8. **Null Returns**: Return `null` on errors, not exceptions

## Common Issues

### Issue: "Cannot import NextAuth on the server"
**Solution**: Use dynamic imports in the factory function, which is already done.

### Issue: "Token validation fails"
**Solution**: Ensure your token verification matches your backend's signing algorithm.

### Issue: "Session always null in getSession"
**Solution**: Check that the session storage/cookie is accessible from the client.

### Issue: "signOut doesn't clear the session"
**Solution**: Ensure both provider-side AND client-side state are cleared.

## Testing Your Plugin

```typescript
// lib/auth-plugin/__tests__/my-plugin.test.ts

import { createMyPlugin } from '../my-plugin';

describe('MyPlugin', () => {
  const plugin = createMyPlugin();

  test('has correct name', () => {
    expect(plugin.name).toBe('my-provider');
  });

  test('signIn returns null on invalid token', async () => {
    const result = await plugin.signIn('');
    expect(result).toBeNull();
  });

  test('signIn returns session on valid token', async () => {
    const result = await plugin.signIn('valid-token');
    expect(result).not.toBeNull();
    expect(result?.userId).toBeDefined();
  });

  test('getSession returns null when not authenticated', async () => {
    const result = await plugin.getSession();
    expect(result).toBeNull();
  });

  test('signOut clears session', async () => {
    await plugin.signIn('token');
    await plugin.signOut();
    const session = await plugin.getSession();
    expect(session).toBeNull();
  });
});
```

## See Also

- `index.ts` - Interface definitions
- `nextauth-plugin.ts` - Reference implementation
- `demo-plugin.ts` - Simple implementation
- `auth0-plugin.ts` - Complex implementation template
