import { useEffect, useState } from 'react';

/** Reactive CSS media query. */
export function useMedia(query: string): boolean {
  const [match, setMatch] = useState(() => typeof matchMedia !== 'undefined' && matchMedia(query).matches);
  useEffect(() => {
    const mq = matchMedia(query);
    const on = () => setMatch(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [query]);
  return match;
}

/** Phone layout: bottom navigation, drawer dashboard, 3-day "week". */
export const PHONE = '(max-width: 760px)';
export const useIsPhone = () => useMedia(PHONE);
/** Touch screens get taller tap targets on the board. */
export const useCoarsePointer = () => useMedia('(pointer: coarse)');

/** Days shown by the Week view: 7, or 3 on phones. */
export const weekSpan = (phone: boolean) => (phone ? 3 : 7);
