/**
 * NextAuth Authentication Plugin
 *
 * Wraps NextAuth.js client-side functions to provide a unified auth interface.
 * Compatible with the existing auth.ts configuration.
 */

import { signIn as nextAuthSignIn, signOut as nextAuthSignOut, getSession as nextAuthGetSession } from 'next-auth/react';
import type { AuthPlugin, Session } from './index';

/**
 * NextAuth plugin implementation
 *
 * Uses NextAuth.js client-side functions to manage authentication.
 * Adapts NextAuth session format to the plugin's standard Session interface.
 */
class NextAuthPlugin implements AuthPlugin {
  name = 'nextauth';

  /**
   * Sign in with a credentials token via NextAuth
   *
   * @param token - Access token from device authorization flow
   * @returns Plugin's standard Session format on success, null on failure
   */
  async signIn(token: string): Promise<Session | null> {
    try {
      const result = await nextAuthSignIn('credentials', {
        token,
        redirect: false,
      });

      if (!result?.ok) {
        return null;
      }

      // Fetch the session after successful sign in
      return this.getSession();
    } catch (error) {
      console.error('NextAuth signIn error:', error);
      return null;
    }
  }

  /**
   * Get the current NextAuth session and convert to standard format
   *
   * @returns Current session in standard format, or null if not authenticated
   */
  async getSession(): Promise<Session | null> {
    try {
      const nextAuthSession = await nextAuthGetSession();

      if (!nextAuthSession?.user) {
        return null;
      }

      // Convert NextAuth session format to our standard Session format
      return {
        userId: (nextAuthSession.user.id as string) || nextAuthSession.user.email || 'unknown',
        user: {
          email: nextAuthSession.user.email,
          name: nextAuthSession.user.name,
          id: nextAuthSession.user.id as string,
        },
        // NextAuth session default maxAge is 24 hours
        expiresAt: Date.now() + 24 * 60 * 60 * 1000,
      };
    } catch (error) {
      console.error('NextAuth getSession error:', error);
      return null;
    }
  }

  /**
   * Sign out the current user via NextAuth
   */
  async signOut(): Promise<void> {
    try {
      await nextAuthSignOut({ redirect: false });
    } catch (error) {
      console.error('NextAuth signOut error:', error);
      // Still consider it a success even if there's an error
      // (user is no longer authenticated after calling signOut)
    }
  }
}

/**
 * Factory function to create a NextAuth plugin instance
 *
 * @returns NextAuth plugin instance
 *
 * @example
 * const plugin = createNextAuthPlugin();
 * const session = await plugin.getSession();
 */
export function createNextAuthPlugin(): AuthPlugin {
  return new NextAuthPlugin();
}
