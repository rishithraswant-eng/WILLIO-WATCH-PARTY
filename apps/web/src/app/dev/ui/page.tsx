import { notFound } from 'next/navigation';
import { UiGallery } from '@/features/landing/UiGallery';

export const metadata = { title: 'UI gallery' };

/** Component gallery (dev only). */
export default function DevUiPage() {
  if (process.env.NODE_ENV === 'production' && process.env.NEXT_PUBLIC_ENABLE_DEV_UI !== 'true') notFound();
  return <UiGallery />;
}
