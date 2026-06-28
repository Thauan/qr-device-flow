/**
 * Authentication Plugin System
 *
 * Provides a unified interface for different authentication providers
 * (NextAuth, Auth0, Supabase, etc.), allowing seamless provider switching
 * without modifying application logic.
 */

/**
 * Represents an authenticated session
 */
export interface Session {
  /** Unique user identifier */
  userId: string;
  /** Optional user details */
  user?: {
    email?: string;
    name?: string;
    id?: string;
  };
  /** Token expiration timestamp (milliseconds since epoch) */
  expiresAt?: number;
}

/**
 * Authentication plugin interface
 *
 * All authentication providers must implement this interface
 * to be compatible with the application.
 */
export interface AuthPlugin {
  /** Plugin name (e.g., 'nextauth', 'auth0', 'supabase') */
  name: string;

  /**
   * Sign in with an access token from device authorization flow
   *
   * @param token - Access token from the device authorization flow
   * @returns Promise resolving to Session on success, null on failure
   *
   * @example
   * const session = await authPlugin.signIn(accessToken);
   */
  signIn(token: string): Promise<Session | null>;

  /**
   * Get the current authenticated session
   *
   * @returns Promise resolving to current Session, or null if not authenticated
   *
   * @example
   * const session = await authPlugin.getSession();
   * if (session) {
   *   console.log('User:', session.userId);
   * }
   */
  getSession(): Promise<Session | null>;

  /**
   * Sign out the current user
   *
   * @returns Promise that resolves when sign out is complete
   *
   * @example
   * await authPlugin.signOut();
   */
  signOut(): Promise<void>;
}

/** Supported authentication providers */
export type AuthProvider = 'nextauth' | 'auth0' | 'supabase' | 'demo';

/**
 * Factory function to create an auth plugin for the specified provider
 *
 * @param provider - The authentication provider to use
 * @returns AuthPlugin instance configured for the specified provider
 *
 * @throws Error if the provider is not supported
 *
 * @example
 * // Use NextAuth
 * const plugin = createAuthPlugin('nextauth');
 *
 * @example
 * // Use demo plugin for testing
 * const plugin = createAuthPlugin('demo');
 *
 * @example
 * // Use Auth0
 * const plugin = createAuthPlugin('auth0');
 */
export function createAuthPlugin(provider: AuthProvider): AuthPlugin {
  switch (provider) {
    case 'nextauth':
      // Import dynamically to avoid bundling unnecessary dependencies
      return require('./nextauth-plugin').createNextAuthPlugin();
    case 'demo':
      return require('./demo-plugin').createDemoPlugin();
    case 'auth0':
      return require('./auth0-plugin').createAuth0Plugin();
    case 'supabase':
      // TODO: Implement Supabase plugin
      throw new Error('Supabase provider not yet implemented');
    default:
      throw new Error(`Unknown authentication provider: ${provider}`);
  }
}
