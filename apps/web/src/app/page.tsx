import { LandingView } from '@/features/landing/LandingView';
import { HomeHeader } from '@/features/hero/HomeHeader';
import { ScrollHero } from '@/features/hero/ScrollHero';

export default function HomePage() {
  return (
    <>
      <HomeHeader />
      <ScrollHero />
      <LandingView topBar={false} />
    </>
  );
}
