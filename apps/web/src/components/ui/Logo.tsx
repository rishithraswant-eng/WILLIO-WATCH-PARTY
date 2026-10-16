import Link from 'next/link';

/** Pixel block cube + wordmark. */
export function LogoCube({ size = 28 }: { size?: number }) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} shapeRendering="crispEdges" aria-hidden>
      {/* top face (moss) */}
      <polygon points="8,1 15,4.5 8,8 1,4.5" fill="#7bbf2f" />
      <polygon points="8,2.5 12.5,4.5 8,6.5 3.5,4.5" fill="#3ddc84" opacity="0.6" />
      {/* left face (dirt) */}
      <polygon points="1,4.5 8,8 8,15 1,11.5" fill="#5b3b24" />
      {/* right face (darker) */}
      <polygon points="15,4.5 8,8 8,15 15,11.5" fill="#3e2817" />
      <rect x="3" y="8" width="1" height="1" fill="#2ee6c5" />
      <rect x="11" y="9" width="1" height="1" fill="#2ee6c5" />
    </svg>
  );
}

export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <Link href="/" className="group inline-flex items-center gap-2.5" aria-label="Willio home">
      <span className="transition-transform duration-200 ease-out group-hover:-translate-y-0.5">
        <LogoCube />
      </span>
      {!compact ? (
        <span className="font-pixel text-[11px] tracking-tight text-hi sm:text-xs">
          WIL<span className="text-teal-400">LIO</span>
        </span>
      ) : null}
    </Link>
  );
}
