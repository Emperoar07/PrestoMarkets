import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import '@rainbow-me/rainbowkit/styles.css';
import './globals.css';
import { AppStateProvider } from '@/lib/appState';
import { RainbowKitProviders } from '@/components/RainbowKitProviders';
import { CircleConfirmModal } from '@/components/CircleConfirmModal';
import { NavigationLoader } from '@/components/NavigationLoader';
import { Suspense } from 'react';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'Presto Markets',
  description: 'Prediction, opinion, and opportunity markets on Arc.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className={inter.className}>
        <div className="presto-grid" aria-hidden="true" />
        <div className="presto-glow" aria-hidden="true" />
        <RainbowKitProviders>
          <Suspense fallback={null}>
            <NavigationLoader />
          </Suspense>
          <AppStateProvider>{children}</AppStateProvider>
          <CircleConfirmModal />
        </RainbowKitProviders>
      </body>
    </html>
  );
}
