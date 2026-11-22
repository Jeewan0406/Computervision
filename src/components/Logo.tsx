import { useId } from 'react';

const FLAG_COLOURS = ['#1F5AA6', '#FFFFFF', '#C8102E', '#1E8A4C', '#FFD100'];

/**
 * JeeA! logo: a bold "J!" speech bubble in gold on a dzong-maroon tile, with
 * a strip of the five prayer-flag colours along the bottom. Few shapes, so it
 * stays readable even as a 16-pixel browser icon. Same drawing as favicon.svg.
 */
export function LogoMark({ size = 32, className = '' }: { size?: number; className?: string }) {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" className={className} aria-hidden="true">
      <defs>
        <linearGradient id={`jt${id}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#A3263A" />
          <stop offset="1" stopColor="#5E0F1D" />
        </linearGradient>
        <linearGradient id={`jb${id}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#FFD45C" />
          <stop offset="1" stopColor="#F39A32" />
        </linearGradient>
        <clipPath id={`jc${id}`}>
          <rect width="64" height="64" rx="14" />
        </clipPath>
      </defs>
      <g clipPath={`url(#jc${id})`}>
        <rect width="64" height="64" fill={`url(#jt${id})`} />
        {FLAG_COLOURS.map((c, i) => (
          <rect key={c} x={i * 12.8} y="58.5" width="12.9" height="5.5" fill={c} />
        ))}
      </g>
      <path d="M20.5 7.5H43.5A12 12 0 0 1 55.5 19.5V32A12 12 0 0 1 43.5 44H29L17 53.5L19.5 43.6A12 12 0 0 1 8.5 32V19.5A12 12 0 0 1 20.5 7.5Z" fill={`url(#jb${id})`} />
      <path d="M34.6 16.6V29A6.4 6.4 0 0 1 21.8 29" fill="none" stroke="#7A1526" strokeWidth="7.2" strokeLinecap="round" />
      <path d="M44.8 16.6V26.2" stroke="#7A1526" strokeWidth="7.2" strokeLinecap="round" />
      <circle cx="44.8" cy="35.2" r="3.8" fill="#7A1526" />
    </svg>
  );
}

export function Wordmark({ small = false }: { small?: boolean }) {
  return (
    <span className={`wordmark${small ? ' wordmark-sm' : ''}`}>
      Jee<span className="wordmark-a">A</span>
      <span className="wordmark-bang">!</span>
    </span>
  );
}

export function GithubIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 .5C5.65.5.5 5.65.5 12a11.5 11.5 0 0 0 7.86 10.92c.58.1.79-.25.79-.56v-2c-3.2.7-3.87-1.37-3.87-1.37-.53-1.33-1.28-1.69-1.28-1.69-1.05-.71.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.68 0-1.26.45-2.28 1.19-3.09-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.78 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.83 1.19 3.09 0 4.41-2.7 5.38-5.26 5.67.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5Z" />
    </svg>
  );
}
