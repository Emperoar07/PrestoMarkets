import type { Metadata } from 'next';
import './globals.css';
import { AppStateProvider } from '@/lib/appState';

export const metadata: Metadata = {
  title: 'Presto Markets',
  description: 'Prediction, opinion, and opportunity markets on Arc.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body>
        <AppStateProvider>{children}</AppStateProvider>
      </body>
    </html>
  );
}
