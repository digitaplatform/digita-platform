import { useSyncExternalStore } from 'react';

const subscribe = (onChange: () => void) => {
  window.addEventListener('resize', onChange);
  return () => window.removeEventListener('resize', onChange);
};

/** The viewport height, re-read on every resize, so a frame sized as a share of
 *  it follows a rotated phone or a resized window instead of keeping its first
 *  measurement. */
export function useViewportHeight(): number {
  return useSyncExternalStore(subscribe, () => window.innerHeight);
}
