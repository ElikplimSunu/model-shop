import type { Metadata } from 'next';
import Notes from '../components/Notes';

export const metadata: Metadata = { title: 'How it works · Model Shop' };

export default function HowItWorks() {
  return <Notes />;
}
