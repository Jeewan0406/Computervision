import { useId } from 'react';

/**
 * JeeA! logo: a chat bubble holding three connected nodes, one per AI model,
 * on a violet-to-cyan gradient. It says "many models, one conversation".
 */
/**
 * JeeA! logo: a chat bubble holding three connected nodes (many AI models,
 * one conversation) with a small gold jewel at the centre, under a string of
 * the five prayer-flag colours, on a saffron-to-maroon tile inspired by
 * Bhutanese colours.
 */
export function LogoMark({ size = 32, className = '' }: { size?: number; className?: string }) {
  const id = useId().replace(/:/g, '');
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" className={className} aria-hidden="true">
      <defs>
        <linearGradient id={`jg${id}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#FFC93C" />
          <stop offset="0.42" stopColor="#F08A24" />
          <stop offset="0.74" stopColor="#C24A0E" />
          <stop offset="1" stopColor="#8B1E2D" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="15" fill={`url(#jg${id})`} />
      <path d="M7 8.5 Q32 13 57 8.5" fill="none" stroke="#FFF8EE" strokeOpacity="0.85" strokeWidth="0.9" />
      <path d="M10.5 9.1h7l-1.2 5.2h-6z" fill="#1F5AA6" />
      <path d="M19.8 10.3h7l-1.1 5.1h-6z" fill="#FFFFFF" />
      <path d="M29.1 10.8h7l-1 5h-6z" fill="#C8102E" />
      <path d="M38.4 10.3h7l-1.1 5.1h-6z" fill="#1E8A4C" />
      <path d="M47.7 9.1h7l-1.2 5.2h-6z" fill="#FFD100" />
      <path d="M18 20h28a7 7 0 0 1 7 7v13a7 7 0 0 1-7 7H31l-9.5 7.5V47H18a7 7 0 0 1-7-7V27a7 7 0 0 1 7-7z" fill="#FFF8EE" />
      <path d="M22.5 38 32 27.5 41.5 38Z" fill="none" stroke="#8B1E2D" strokeOpacity="0.4" strokeWidth="2.2" strokeLinejoin="round" />
      <circle cx="22.5" cy="38" r="4.4" fill="#1F5AA6" />
      <circle cx="32" cy="27.5" r="4.4" fill="#C8102E" />
      <circle cx="41.5" cy="38" r="4.4" fill="#1E8A4C" />
      <path d="M32 31.6 34.6 34.4 32 37.2 29.4 34.4Z" fill="#F5B301" stroke="#8B1E2D" strokeWidth="0.8" />
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
