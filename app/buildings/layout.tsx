import type { Metadata } from 'next';

// The page itself is a client component, so its tab title lives here.
export const metadata: Metadata = {
  title: 'Buildings',
  description: 'Type a building as measurements in metres and get an exact 3D model you can turn, measure and download.',
};

export default function BuildingsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
