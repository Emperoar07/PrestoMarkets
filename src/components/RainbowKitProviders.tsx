'use client';

import { RainbowKitProvider, darkTheme } from '@rainbow-me/rainbowkit';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { WagmiProvider } from 'wagmi';
import { arcTestnetChain, rainbowConfig } from '@/lib/rainbowConfig';

export function RainbowKitProviders({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());

  return (
    <WagmiProvider config={rainbowConfig}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider
          initialChain={arcTestnetChain}
          modalSize="compact"
          theme={darkTheme({
            accentColor: '#25c0f4',
            accentColorForeground: '#090e1a',
            borderRadius: 'large',
            fontStack: 'system',
            overlayBlur: 'small',
          })}
        >
          {children}
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
