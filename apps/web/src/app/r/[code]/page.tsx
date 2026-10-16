import type { Metadata } from 'next';
import { RoomView } from '@/features/room/RoomView';

export function generateMetadata({ params }: { params: { code: string } }): Metadata {
  return { title: `Room ${params.code.toUpperCase()}` };
}

export default function RoomPage({ params }: { params: { code: string } }) {
  return <RoomView code={params.code} />;
}
