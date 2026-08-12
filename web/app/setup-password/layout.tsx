import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Set your password',
  robots: { index: false, follow: false }
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
