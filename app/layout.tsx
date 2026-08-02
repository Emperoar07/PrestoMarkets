import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import '@rainbow-me/rainbowkit/styles.css';
import './globals.css';
import { AppStateProvider } from '@/lib/appState';
import { SocialSessionProvider } from '@/lib/socialSessionContext';
import { TransactionProvider } from '@/lib/transactions';
import { ToastStack } from '@/components/ToastStack';
import { LimitOrderWatcher } from '@/components/LimitOrderWatcher';
import { RainbowKitProviders } from '@/components/RainbowKitProviders';
import { CircleConfirmModal } from '@/components/CircleConfirmModal';
import { SignInModal } from '@/components/SignInModal';
import { AutoSocialSignIn } from '@/components/AutoSocialSignIn';
import { BrandLoadingOverlay } from '@/components/BrandLoader';
import { NavigationLoader } from '@/components/NavigationLoader';
import { Suspense } from 'react';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL || 'https://presto-markets.pages.dev'),
  title: 'Presto Markets',
  description: 'Prediction and opinion markets on Arc.',
  openGraph: {
    title: 'Presto Markets',
    description: 'Prediction and opinion markets on Arc.',
    images: ['/icon.svg'],
  },
  twitter: {
    card: 'summary',
    title: 'Presto Markets',
    description: 'Prediction and opinion markets on Arc.',
    images: ['/icon.svg'],
  },
  icons: {
    icon: [
      { url: '/icon.svg', type: 'image/svg+xml' },
      { url: '/favicon.ico' },
    ],
    apple: [{ url: '/icon.svg' }],
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className={inter.className}>
        <div className="presto-grid" aria-hidden="true" />
        <div className="presto-glow" aria-hidden="true" />
        <RainbowKitProviders>
          <Suspense fallback={<BrandLoadingOverlay />}>
            <NavigationLoader />
          </Suspense>
          <SocialSessionProvider>
            <AppStateProvider>
              <TransactionProvider>
                {children}
                <ToastStack />
                <LimitOrderWatcher />
              </TransactionProvider>
              <SignInModal />
              <AutoSocialSignIn />
            </AppStateProvider>
          </SocialSessionProvider>
          <CircleConfirmModal />
        </RainbowKitProviders>
      </body>
    </html>
  );
}
