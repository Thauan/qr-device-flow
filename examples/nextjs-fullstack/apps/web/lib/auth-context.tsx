/**
 * Authentication Context Provider
 *
 * Provides auth plugin and session state to the application.
 * Wraps the application with AuthProvider to access useAuth() hook.
 */

'use client';

import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import type { AuthPlugin, Session, AuthProvider as AuthProviderType } from './auth-plugin';
import { createAuthPlugin } from './auth-plugin';

/**
 * Return type for useAuth() hook
 */
export interface AuthContextType {
  /** Current authenticated session, or null if not authenticated */
  session: Session | null;
  /** Sign in with access token from device authorization flow */
  signIn: (token: string) => Promise<Session | null>;
  /** Sign out current user */
  signOut: () => Promise<void>;
  /** Whether auth is being initialized */
  isLoading: boolean;
  /** Current authentication plugin instance */
  plugin: AuthPlugin;
}

/**
 * React context for authentication
 * @internal Use useAuth() hook instead of accessing directly
 */
const AuthContext = createContext<AuthContextType | undefined>(undefined);

/**
 * Props for AuthProvider component
 */
export interface AuthProviderProps {
  /** Authentication provider to use ('nextauth', 'demo', 'auth0', 'supabase') */
  provider: AuthProviderType;
  /** Child components that will have access to auth context */
  children: ReactNode;
}

/**
 * Authentication Provider Component
 *
 * Wraps the application to provide auth context and session management.
 * Must wrap any components that use the useAuth() hook.
 *
 * @example
 * ```tsx
 * import { AuthProvider } from '@/lib/auth-context';
 *
 * export default function App() {
 *   return (
 *     <AuthProvider provider="nextauth">
 *       <YourApp />
 *     </AuthProvider>
 *   );
 * }
 * ```
 *
 * @example With demo provider for testing
 * ```tsx
 * <AuthProvider provider="demo">
 *   <YourApp />
 * </AuthProvider>
 * ```
 */
export function AuthProvider({ provider, children }: AuthProviderProps) {
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [authPlugin] = useState<AuthPlugin>(() => createAuthPlugin(provider));

  // Initialize session on mount
  useEffect(() => {
    const initializeAuth = async () => {
      try {
        const currentSession = await authPlugin.getSession();
        setSession(currentSession);
      } catch (error) {
        console.error('Failed to initialize auth:', error);
        setSession(null);
      } finally {
        setIsLoading(false);
      }
    };

    initializeAuth();
  }, [authPlugin]);

  /**
   * Sign in handler
   */
  const handleSignIn = async (token: string): Promise<Session | null> => {
    try {
      const newSession = await authPlugin.signIn(token);
      setSession(newSession);
      return newSession;
    } catch (error) {
      console.error('Sign in failed:', error);
      return null;
    }
  };

  /**
   * Sign out handler
   */
  const handleSignOut = async (): Promise<void> => {
    try {
      await authPlugin.signOut();
      setSession(null);
    } catch (error) {
      console.error('Sign out failed:', error);
      setSession(null); // Clear session anyway
    }
  };

  const value: AuthContextType = {
    session,
    signIn: handleSignIn,
    signOut: handleSignOut,
    isLoading,
    plugin: authPlugin,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/**
 * Hook to access authentication context
 *
 * Must be called from a component wrapped with AuthProvider.
 * Provides session state and auth methods.
 *
 * @returns Auth context containing session, methods, and plugin
 * @throws Error if used outside AuthProvider
 *
 * @example
 * ```tsx
 * function LoginComponent() {
 *   const { session, signIn } = useAuth();
 *
 *   const handleLogin = async () => {
 *     const result = await signIn(accessToken);
 *     if (result) {
 *       console.log('Logged in as:', result.userId);
 *     }
 *   };
 *
 *   return (
 *     <div>
 *       {session ? `Welcome ${session.user?.name}` : 'Not logged in'}
 *       <button onClick={handleLogin}>Sign In</button>
 *     </div>
 *   );
 * }
 * ```
 *
 * @example Check if authenticated
 * ```tsx
 * function ProtectedComponent() {
 *   const { session, isLoading } = useAuth();
 *
 *   if (isLoading) return <div>Loading...</div>;
 *   if (!session) return <div>Not authenticated</div>;
 *
 *   return <div>Welcome {session.userId}</div>;
 * }
 * ```
 */
export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);

  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider component');
  }

  return context;
}
