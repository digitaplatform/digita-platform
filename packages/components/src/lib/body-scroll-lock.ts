// How many open overlays hold the page's scroll lock, and the page's own overflow from before the
// first one. Overlays open and close over each other in any order (a dialog over a drawer, two
// drawers), so the page scrolls again only when the last of them lets go.
let holders = 0;
let pageOverflow = '';

/** Stop the page behind an overlay from scrolling; the returned function releases this hold. */
export function lockBodyScroll(): () => void {
  if (holders === 0) pageOverflow = document.body.style.overflow;
  holders += 1;
  document.body.style.overflow = 'hidden';
  let held = true;
  return () => {
    if (!held) return;
    held = false;
    holders -= 1;
    if (holders === 0) document.body.style.overflow = pageOverflow;
  };
}
