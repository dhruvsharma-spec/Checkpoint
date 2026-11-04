'use client';
import { ConfirmProvider, SessionProvider, ToastProvider } from '@/lib/hooks';
import { Shell } from '@/components/Shell';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <ToastProvider>
      <ConfirmProvider>
        <SessionProvider>
          <Shell>{children}</Shell>
        </SessionProvider>
      </ConfirmProvider>
    </ToastProvider>
  );
}
