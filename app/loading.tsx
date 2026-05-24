import { BrandLoader } from '@/components/BrandLoader';

export default function Loading() {
  return (
    <div className="fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-[#020617]/50 backdrop-blur-md">
      <BrandLoader />
    </div>
  );
}
