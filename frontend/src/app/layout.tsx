import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = { title: 'Checkpoint', description: 'One place to track every launch.' };

// Sets the saved theme before first paint so there is no flash.
// The sign-in page is always dark. Every other page is light unless the person chose dark with the switch.
const themeScript = `var t='light';try{if(location.pathname.indexOf('/login')===0)t='dark';else t=localStorage.getItem('cp-theme')||'light'}catch(e){}document.documentElement.dataset.theme=t`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="light" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500&family=Sora:wght@300;400;600&display=swap" rel="stylesheet" />
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body style={{ margin: 0, background: 'var(--bg)', color: 'var(--ink)', fontFamily: "'Plus Jakarta Sans',system-ui,sans-serif", fontSize: 13.5, lineHeight: 1.45, letterSpacing: '-0.005em', minHeight: '100vh' }}>{children}</body>
    </html>
  );
}
