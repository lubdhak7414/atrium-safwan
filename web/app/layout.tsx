import type { Metadata } from 'next';
import { Archivo, IBM_Plex_Mono } from 'next/font/google';
import './globals.css';
import { CurrentUserProvider } from '../components/CurrentUserProvider';
import { RoleNav } from '../components/RoleNav';

const archivo = Archivo({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  display: 'swap',
  variable: '--font-archivo'
});

const plexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  display: 'swap',
  variable: '--font-plex-mono'
});

export const metadata: Metadata = {
  title: { template: '%s · Atrium', default: 'Atrium Coaching Centre' },
  description: 'Book coaching sessions at Atrium Coaching Centre — browse upcoming classes, compare prices, and reserve a place.'
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${archivo.variable} ${plexMono.variable}`}>
      <body>
        <CurrentUserProvider>
          <RoleNav />
          {children}
        </CurrentUserProvider>
      </body>
    </html>
  );
}
