import { useState } from 'react';

// Single source of truth for the Flint logo.
// ──────────────────────────────────────────
// HOW TO CHANGE THE LOGO:
//   1. Replace  public/flint-logo.png  with your own image (same filename)
//   2. Rebuild:  npm run build   or   bash install.sh
//   3. The new logo appears everywhere automatically.
//
// No other file needs to change. Every component imports FlintLogo.
// ──────────────────────────────────────────

// Cache buster: evaluated once per page load so the browser/Electron
// always fetches the latest PNG from disk instead of a stale cached copy.
const _t = Date.now();

export function FlintLogo({ size = 20, className }: { size?: number; className?: string }) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className={className}
        style={{ pointerEvents: 'none', userSelect: 'none', display: 'inline-block', verticalAlign: 'middle' }}
        aria-label="Flint"
      >
        <path
          d="M12 2C9.5 6 6 9 6 13.5C6 17.09 8.91 20 12.5 20C16.09 20 19 17.09 19 13.5C19 10 16 6.5 12 2Z"
          fill="url(#flintGradient)"
        />
        <path
          d="M12 9C10.5 11.5 9 13 9 15C9 16.66 10.34 18 12 18C13.66 18 15 16.66 15 15C15 13 13.5 11.5 12 9Z"
          fill="#FFF3D6"
          opacity="0.85"
        />
        <defs>
          <linearGradient id="flintGradient" x1="6" y1="2" x2="19" y2="20" gradientUnits="userSpaceOnUse">
            <stop stopColor="#F59E0B" />
            <stop offset="1" stopColor="#D97706" />
          </linearGradient>
        </defs>
      </svg>
    );
  }

  return (
    <img
      src={`./flint-logo.png?t=${_t}`}
      alt="Flint"
      width={size}
      height={size}
      className={className}
      style={{ objectFit: 'contain', pointerEvents: 'none', userSelect: 'none' }}
      draggable={false}
      onError={(e) => {
        const target = e.currentTarget;
        if (target.src.includes('?')) {
          target.src = './flint-logo.png';
        } else if (!target.src.endsWith('/flint-logo.png') && !target.src.endsWith('flint-logo.png')) {
          target.src = 'flint-logo.png';
        } else {
          setFailed(true);
        }
      }}
    />
  );
}

export function FlintLogoLarge({ size = 64, className }: { size?: number; className?: string }) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className={className}
        style={{ pointerEvents: 'none', userSelect: 'none', display: 'inline-block', verticalAlign: 'middle' }}
        aria-label="Flint"
      >
        <path
          d="M12 2C9.5 6 6 9 6 13.5C6 17.09 8.91 20 12.5 20C16.09 20 19 17.09 19 13.5C19 10 16 6.5 12 2Z"
          fill="url(#flintGradientLarge)"
        />
        <path
          d="M12 9C10.5 11.5 9 13 9 15C9 16.66 10.34 18 12 18C13.66 18 15 16.66 15 15C15 13 13.5 11.5 12 9Z"
          fill="#FFF3D6"
          opacity="0.85"
        />
        <defs>
          <linearGradient id="flintGradientLarge" x1="6" y1="2" x2="19" y2="20" gradientUnits="userSpaceOnUse">
            <stop stopColor="#F59E0B" />
            <stop offset="1" stopColor="#D97706" />
          </linearGradient>
        </defs>
      </svg>
    );
  }

  return (
    <img
      src={`./flint-logo.png?t=${_t}`}
      alt="Flint"
      width={size}
      height={size}
      className={className}
      style={{ objectFit: 'contain', pointerEvents: 'none', userSelect: 'none' }}
      draggable={false}
      onError={(e) => {
        const target = e.currentTarget;
        if (target.src.includes('?')) {
          target.src = './flint-logo.png';
        } else if (!target.src.endsWith('/flint-logo.png') && !target.src.endsWith('flint-logo.png')) {
          target.src = 'flint-logo.png';
        } else {
          setFailed(true);
        }
      }}
    />
  );
}

export default FlintLogo;
