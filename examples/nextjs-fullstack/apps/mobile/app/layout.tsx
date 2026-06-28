import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Mobile Simulator - QR Device Flow',
  description: 'Mobile app simulator for QR Device Flow demo',
  viewport: 'width=device-width, initial-scale=1, maximum-scale=1',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
