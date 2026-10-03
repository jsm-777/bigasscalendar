import { useEffect, useRef, type ReactNode } from 'react';

/** Bottom sheet on phones, centered card on larger screens. */
export function Sheet({ title, onClose, children, footer, accent }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; accent?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    (ref.current?.querySelector<HTMLElement>('[autofocus]') ?? ref.current?.querySelector<HTMLElement>('button, input, select, textarea'))?.focus();
    return () => prev?.focus?.();
  }, []);
  return (
    <div className="sheet-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={ref}
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        style={accent ? ({ ['--accent' as string]: accent } as React.CSSProperties) : undefined}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            onClose();
          }
        }}
      >
        <div className="sheet-grip" aria-hidden />
        <div className="sheet-head">
          <h2>{title}</h2>
          <button className="round-btn" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="sheet-body">{children}</div>
        {footer && <div className="sheet-foot">{footer}</div>}
      </div>
    </div>
  );
}
