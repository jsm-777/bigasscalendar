import { useStore } from '../store.tsx';

export function Toasts() {
  const s = useStore();
  return (
    <div className="toasts" role="status" aria-live="polite">
      {s.toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`}>
          <span>{t.text}</span>
          {t.action && <button className="link" onClick={() => { t.action!.run(); s.setToasts((x) => x.filter((y) => y.id !== t.id)); }}>{t.action.label}</button>}
          <button className="icon-btn small" aria-label="Dismiss" onClick={() => s.setToasts((x) => x.filter((y) => y.id !== t.id))}>✕</button>
        </div>
      ))}
    </div>
  );
}
