import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Presto Markets',
  description: 'Prediction, opinion, and opportunity markets on Arc.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body>{children}</body>
    </html>
  );
}
