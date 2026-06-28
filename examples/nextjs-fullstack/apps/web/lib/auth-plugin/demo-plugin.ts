/**
 * Demo Authentication Plugin
 *
 * Simple in-memory session storage for testing and development.
 * Useful for testing authentication flows without NextAuth setup.
 * Data is cleared on page refresh.
 */

import type { AuthPlugin, Session } from './index';

/**
 * In-memory storage for demo sessions
 * Only available in the current client session
 */
let currentSession: Session | null = null;

/**
 * Demo authentication plugin implementation
 *
 * Stores sessions in memory. Useful for:
 * - Testing authentication flows
 * - Development without full auth provider setup
 * - Demo environments
 *
 * Note: Sessions are cleared when the page is refreshed.
 */
class DemoAuthPlugin implements AuthPlugin {
  name = 'demo';

  /**
   * Mock sign in - accepts any token and creates a demo session
   *
   * @param token - Access token (can be any string in demo mode)
   * @returns A demo session with mock user data
   */
  async signIn(token: string): Promise<Session | null> {
    if (!token) {
      return null;
    }

    try {
      // Simulate token validation delay
      await new Promise(resolve => setTimeout(resolve, 300));

      // Create a mock session from the token
      // In a real scenario, this would validate and decode the token
      const mockSession: Session = {
        userId: `demo-user-${Date.now()}`,
        user: {
          email: 'demo@example.com',
          name: 'Demo User',
          id: `demo-user-${Date.now()}`,
        },
        expiresAt: Date.now() + 24 * 60 * 60 * 1000, // 24 hours
      };

      currentSession = mockSession;
      return mockSession;
    } catch (error) {
      console.error('Demo plugin signIn error:', error);
      return null;
    }
  }

  /**
   * Get the current demo session
   *
   * @returns Current session if authenticated, null otherwise
   */
  async getSession(): Promise<Session | null> {
    // Simulate network delay
    await new Promise(resolve => setTimeout(resolve, 100));
    return currentSession;
  }

  /**
   * Clear the current demo session
   */
  async signOut(): Promise<void> {
    // Simulate sign out delay
    await new Promise(resolve => setTimeout(resolve, 100));
    currentSession = null;
  }
}

/**
 * Factory function to create a demo plugin instance
 *
 * @returns Demo plugin instance
 *
 * @example
 * const plugin = createDemoPlugin();
 * const session = await plugin.signIn('test-token');
 */
export function createDemoPlugin(): AuthPlugin {
  return new DemoAuthPlugin();
}
