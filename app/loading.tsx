import { BrandLoader } from '@/components/BrandLoader';

export default function Loading() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center">
      <BrandLoader />
    </div>
  );
}
