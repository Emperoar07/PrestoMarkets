import { CalibrationClient } from '@/components/CalibrationClient';

export const metadata = {
  title: 'Calibration — Presto Markets',
  description: 'How well the Presto agent’s confidence matches real outcomes.',
};

export default function CalibrationPage() {
  return <CalibrationClient />;
}
