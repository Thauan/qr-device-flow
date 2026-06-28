import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import jwt from "jsonwebtoken";

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: "QR Device Flow",
      credentials: {
        token: { label: "Access Token", type: "text" },
      },
      async authorize(credentials) {
        if (!credentials?.token) {
          throw new Error("No token provided");
        }

        try {
          // In production, verify the token signature
          // For demo, we just decode and trust the backend
          const decoded = jwt.decode(credentials.token);

          if (!decoded || typeof decoded === "string") {
            throw new Error("Invalid token");
          }

          return {
            id: (decoded.sub as string) || "user-1",
            name: "Demo User",
            email: "demo@example.com",
          };
        } catch (error) {
          throw new Error("Failed to authorize");
        }
      },
    }),
  ],
  pages: {
    signIn: "/login",
    error: "/login",
  },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
      }
      return session;
    },
  },
  secret: process.env.NEXTAUTH_SECRET || "demo-secret-key",
  session: {
    strategy: "jwt",
    maxAge: 24 * 60 * 60, // 24 hours
  },
};
