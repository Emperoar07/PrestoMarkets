'use client';

import React from 'react';

interface ChanceMeterProps {
  percentage: number; // 0-100
  size?: 'small' | 'medium' | 'large'; // diameter in pixels
  showLabel?: boolean;
}

const sizeMap = {
  small: 60,
  medium: 100,
  large: 140,
};

function getGradientColor(percentage: number): string {
  // 0% = pure red (#ff4444), 50% = gray (#888), 100% = pure blue (#4488ff)
  if (percentage < 50) {
    // Red to gray: 0-50%
    const intensity = (50 - percentage) / 50;
    return `hsl(0, 100%, ${50 + intensity * 25}%)`;
  }
  // Gray to blue: 50-100%
  const intensity = (percentage - 50) / 50;
  return `hsl(220, 100%, ${50 - intensity * 20}%)`;
}

export function ChanceMeter({ percentage, size = 'medium', showLabel = true }: ChanceMeterProps) {
  const diameter = sizeMap[size];
  const radius = diameter / 2;
  const circumference = 2 * Math.PI * (radius - 8); // Account for stroke width

  const offset = circumference * (1 - percentage / 100);

  return (
    <div className="flex flex-col items-center gap-2">
      <svg width={diameter} height={diameter} className="transform -rotate-90">
        {/* Background circle */}
        <circle
          cx={radius}
          cy={radius}
          r={radius - 8}
          fill="none"
          stroke="#2a3744"
          strokeWidth="4"
        />
        {/* Gradient progress circle */}
        <circle
          cx={radius}
          cy={radius}
          r={radius - 8}
          fill="none"
          stroke={getGradientColor(percentage)}
          strokeWidth="4"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          style={{ transition: 'stroke-dashoffset 0.3s ease' }}
        />
      </svg>
      {showLabel && (
        <div className="text-center">
          <div className="text-lg font-bold text-white">{percentage}%</div>
          <div className="text-xs text-gray-400">Chance</div>
        </div>
      )}
    </div>
  );
}
