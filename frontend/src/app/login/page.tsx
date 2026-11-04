'use client';
import { Suspense } from 'react';
import { useLoginFlow } from '@/components/login/useLoginFlow';
import { AperturePage } from '@/components/login/AperturePage';
import '@/components/login/aperture.css';

function LoginInner() {
  const flow = useLoginFlow();
  return <AperturePage flow={flow} />;
}

export default function LoginPage() { return <Suspense fallback={null}><LoginInner /></Suspense>; }
