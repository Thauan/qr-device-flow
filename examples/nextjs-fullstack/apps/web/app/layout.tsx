import type { Metadata } from 'next';
import { AuthProvider } from '@/lib/auth-context';
import './globals.css';

export const metadata: Metadata = {
  title: 'QR Device Flow - Login Demo',
  description: 'RFC 8628 compliant QR-based device authorization',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        {/*
          AuthProvider sets up the authentication plugin system.
          Default provider is 'nextauth' but can be changed to 'demo', 'auth0', etc.
          See lib/auth-plugin/index.ts for available providers.
        */}
        <AuthProvider provider="nextauth">{children}</AuthProvider>
      </body>
    </html>
  );
}
