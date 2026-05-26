'use client';

import React from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { ChanceMeter } from './ChanceMeter';

interface NewsCardProps {
  id: string;
  title: string;
  description?: string;
  imageURI?: string;
  yesPercentage: number;
  noPercentage: number;
  closeDate: string;
  volume: string;
  category?: string;
  type: 'Prediction' | 'Opinion' | 'Opportunity';
}

export function NewsCard({
  id,
  title,
  imageURI,
  yesPercentage,
  noPercentage,
  closeDate,
  volume,
  category,
  type,
}: NewsCardProps) {
  const timeUntilClose = getTimeUntilClose(closeDate);

  return (
    <Link href={`/breaking-news/${id}`}>
      <div className="group relative overflow-hidden rounded-lg border border-white/10 bg-gradient-to-br from-white/5 to-transparent p-4 transition-all hover:border-cyan-400/50 hover:shadow-lg hover:shadow-cyan-400/10">
        {/* Image Container */}
        {imageURI && (
          <div className="relative mb-4 h-40 w-full overflow-hidden rounded-md">
            <Image
              src={imageURI}
              alt={title}
              fill
              className="object-cover transition-transform group-hover:scale-105"
              sizes="(max-width: 640px) 100vw, 400px"
            />
            {/* Market Type Badge */}
            <div className="absolute right-2 top-2 rounded-full bg-black/60 px-3 py-1 text-xs font-semibold text-cyan-400">
              {type === 'Prediction' ? '📊' : type === 'Opinion' ? '💬' : '🚀'} {type}
            </div>
          </div>
        )}

        {/* Title */}
        <h3 className="mb-3 line-clamp-2 text-sm font-bold text-white group-hover:text-cyan-300">
          {title}
        </h3>

        {/* Category */}
        {category && <p className="mb-2 text-xs text-gray-500 uppercase tracking-wide">{category}</p>}

        {/* ChanceMeter */}
        <div className="mb-4 flex justify-center">
          <ChanceMeter percentage={yesPercentage} size="medium" showLabel={true} />
        </div>

        {/* Odds Section */}
        <div className="mb-4 grid grid-cols-2 gap-2">
          <button
            onClick={(e) => e.preventDefault()}
            className="rounded-md border border-cyan-400/30 bg-cyan-400/5 py-2 text-center text-xs font-semibold text-cyan-300 transition hover:bg-cyan-400/15"
          >
            YES {yesPercentage}%
          </button>
          <button
            onClick={(e) => e.preventDefault()}
            className="rounded-md border border-red-400/30 bg-red-400/5 py-2 text-center text-xs font-semibold text-red-300 transition hover:bg-red-400/15"
          >
            NO {noPercentage}%
          </button>
        </div>

        {/* Footer */}
        <div className="border-t border-white/5 pt-3 text-xs text-gray-400">
          <div className="mb-2 flex justify-between">
            <span>Closes {timeUntilClose}</span>
            <span>{volume}</span>
          </div>
        </div>
      </div>
    </Link>
  );
}

function getTimeUntilClose(closeDate: string): string {
  const now = new Date();
  const close = new Date(closeDate);
  const diff = close.getTime() - now.getTime();

  if (diff <= 0) return 'Closed';

  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  if (days > 0) return `in ${days}d`;

  const hours = Math.floor(diff / (1000 * 60 * 60));
  return `in ${hours}h`;
}
