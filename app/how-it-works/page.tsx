import type { Metadata } from 'next';
import Notes from '../components/Notes';

export const metadata: Metadata = { title: 'How it works', description: 'How Model Shop turns a photo or a description into a 3D model, step by step.' };

export default function HowItWorks() {
  return <Notes />;
}
