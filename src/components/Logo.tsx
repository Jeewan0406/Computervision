import markUrl from '../assets/logo-mark.png';

/**
 * JeeA! logo (the owner's design): a head in profile whose brain is a
 * network of linked nodes - many AIs joined in one mind. The picture is used
 * as a mask, so it takes the text colour and works in light and dark themes.
 */
export function LogoMark({ size = 32, className = '' }: { size?: number; className?: string }) {
  return <span className={`logo-mark ${className}`} style={{ width: size, height: size, ['--logo' as string]: `url(${markUrl})` }} aria-hidden="true" />;
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
