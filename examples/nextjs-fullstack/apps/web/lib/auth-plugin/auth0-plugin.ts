/**
 * Auth0 Authentication Plugin
 *
 * Template/skeleton for Auth0 integration.
 * Shows how to extend the plugin system for other providers.
 *
 * To implement:
 * 1. Install @auth0/nextjs-auth0
 * 2. Configure Auth0 environment variables
 * 3. Replace placeholder implementations below
 */

import type { AuthPlugin, Session } from './index';

/**
 * Auth0 plugin implementation (skeleton)
 *
 * To complete this implementation:
 * - Replace this with actual Auth0 client logic
 * - Use @auth0/nextjs-auth0 SDK or Auth0 Core API
 * - Handle Auth0 token management
 *
 * @example Typical Auth0 setup:
 * ```typescript
 * import { getSession, withApiAuthRequired } from '@auth0/nextjs-auth0';
 *
 * // In getSession():
 * const session = await getSession();
 * if (!session) return null;
 *
 * // In signIn():
 * // Use Auth0 Management API to authenticate with device flow token
 *
 * // In signOut():
 * await res.setIronSession({}, session);
 * ```
 */
class Auth0Plugin implements AuthPlugin {
  name = 'auth0';

  /**
   * Sign in with Auth0
   *
   * Implementation notes:
   * - Exchange device flow token with Auth0 Management API
   * - Verify token validity and user ownership
   * - Create Auth0 session
   *
   * @param token - Device flow access token
   * @returns Session on success, null on failure
   */
  async signIn(token: string): Promise<Session | null> {
    try {
      // TODO: Implement Auth0 sign-in logic
      // 1. Send token to Auth0 Management API
      // 2. Validate token and get user info
      // 3. Create session

      if (!token) {
        return null;
      }

      const domain = process.env.AUTH0_DOMAIN;
      const clientId = process.env.NEXT_PUBLIC_AUTH0_CLIENT_ID;

      if (!domain || !clientId) {
        throw new Error('Auth0 environment variables not configured');
      }

      // Example implementation (adjust based on your Auth0 flow):
      // const response = await fetch(`https://${domain}/oauth/token`, {
      //   method: 'POST',
      //   headers: { 'Content-Type': 'application/json' },
      //   body: JSON.stringify({
      //     client_id: clientId,
      //     client_secret: process.env.AUTH0_CLIENT_SECRET,
      //     audience: process.env.AUTH0_AUDIENCE,
      //     grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
      //     subject_token: token,
      //   }),
      // });

      console.warn('Auth0 plugin: signIn not yet implemented');
      return null;
    } catch (error) {
      console.error('Auth0 signIn error:', error);
      return null;
    }
  }

  /**
   * Get current Auth0 session
   *
   * Implementation notes:
   * - Use getSession() from @auth0/nextjs-auth0
   * - Convert Auth0 session format to standard Session
   *
   * @returns Current session or null
   */
  async getSession(): Promise<Session | null> {
    try {
      // TODO: Implement Auth0 session retrieval
      // import { getSession } from '@auth0/nextjs-auth0';
      // const session = await getSession();
      // if (!session) return null;
      //
      // return {
      //   userId: session.user.sub,
      //   user: {
      //     email: session.user.email,
      //     name: session.user.name,
      //     id: session.user.sub,
      //   },
      // };

      console.warn('Auth0 plugin: getSession not yet implemented');
      return null;
    } catch (error) {
      console.error('Auth0 getSession error:', error);
      return null;
    }
  }

  /**
   * Sign out from Auth0
   *
   * Implementation notes:
   * - Clear Auth0 session
   * - Redirect to Auth0 logout endpoint if needed
   */
  async signOut(): Promise<void> {
    try {
      // TODO: Implement Auth0 sign-out logic
      // Option 1: Use @auth0/nextjs-auth0 withApiAuthRequired
      // Option 2: Call Auth0 logout endpoint

      console.warn('Auth0 plugin: signOut not yet implemented');
    } catch (error) {
      console.error('Auth0 signOut error:', error);
    }
  }
}

/**
 * Factory function to create an Auth0 plugin instance
 *
 * @returns Auth0 plugin instance
 *
 * @throws Error if Auth0 environment variables are not configured
 *
 * @example
 * const plugin = createAuth0Plugin();
 * const session = await plugin.getSession();
 */
export function createAuth0Plugin(): AuthPlugin {
  return new Auth0Plugin();
}
