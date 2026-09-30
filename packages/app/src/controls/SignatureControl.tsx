import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { Button } from '@digitaplatform/components';
import type { FieldControlProps } from '@/controls/types';
import { describedBy } from '@/controls/control-styles';
import { useChrome } from '@/lib/chrome-i18n';

/** The pad in CSS pixels. One fixed size keeps every stored signature a small PNG of one shape. */
const PAD_WIDTH = 400;
const PAD_HEIGHT = 160;
const LINE_WIDTH = 2;
/** On paper, which stays light in every design and mode, the dark ink of the transparent PNG shows. */
const IMAGE_CLASS = 'max-h-24 rounded border border-border bg-paper';

/** A signature, stored as a PNG data URL. An editable field is a pad a person signs on with a
 *  finger, a pen or the mouse, and the end of each stroke stores the drawing. A signature the pad
 *  did not draw shows as its image until it is cleared, so it is never drawn and encoded again.
 *  Clear emits `undefined`, the empty value of every control. */
export default function SignatureControl({
  value,
  state,
  onChange,
  controlId,
  labelId,
  describedById,
  errorId,
}: FieldControlProps) {
  const tc = useChrome();
  const stored = typeof value === 'string' && value !== '' ? value : undefined;
  // Sharp on a high-density screen, capped at 2 so a phone's 3x does not store a PNG twice the size.
  // Read once: a new ratio (a zoom) would resize the canvas, which wipes the strokes on it.
  const [ratio] = useState(() => Math.min(window.devicePixelRatio, 2));
  // What the pad's own strokes stored, and the key that gives a blank pad.
  const [drawn, setDrawn] = useState<string>();
  const [padKey, setPadKey] = useState(0);
  const [prevStored, setPrevStored] = useState(stored);
  if (stored !== prevStored) {
    setPrevStored(stored);
    // A value the pad did not draw (a clear, a reload, a reset) takes the place of its strokes.
    if (stored !== drawn) {
      setDrawn(undefined);
      setPadKey((key) => key + 1);
    }
  }
  // A read-only field has no pad, and the strokes go with its canvas: editable again, the field
  // shows what it stores as the image.
  if (state.readOnly && drawn !== undefined) setDrawn(undefined);
  const stroke = useRef<{ canvas: HTMLCanvasElement; pointerId: number; x: number; y: number } | null>(null);
  // Clear unmounts the button that holds the focus, so the pad that takes the signature's place
  // gets it, on the first render after the click and not on any later one.
  const padRef = useRef<HTMLCanvasElement>(null);
  const focusPadNext = useRef(false);
  useEffect(() => {
    if (!focusPadNext.current) return;
    focusPadNext.current = false;
    padRef.current?.focus();
  });

  // The id is the one the field label points at, in the image view as on the pad.
  const image = stored && <img id={controlId} src={stored} alt={tc('ui.signature.alt')} className={IMAGE_CLASS} />;
  if (state.readOnly) return image || <span className="text-sm text-textMuted">{tc('ui.signature.empty')}</span>;

  const clearId = `${controlId}-clear`;
  const clear = (
    <Button
      id={clearId}
      type="button"
      variant="secondary"
      size="sm"
      // Its own text, then the field label: a form with two signatures has two Clear buttons.
      aria-labelledby={`${clearId} ${labelId}`}
      onClick={() => {
        focusPadNext.current = true;
        onChange(undefined);
      }}
    >
      {tc('ui.action.clear')}
    </Button>
  );
  if (stored && stored !== drawn) {
    return (
      <div className="flex flex-col items-start gap-1.5">
        {image}
        {clear}
      </div>
    );
  }

  // In the pad's own units: a narrow screen draws the canvas smaller than PAD_WIDTH. The offset
  // and the client size both leave out the border, so a point lands exactly under the pointer.
  const pointOf = (e: PointerEvent<HTMLCanvasElement>) => ({
    x: (e.nativeEvent.offsetX / e.currentTarget.clientWidth) * PAD_WIDTH,
    y: (e.nativeEvent.offsetY / e.currentTarget.clientHeight) * PAD_HEIGHT,
  });
  // The pointer that started a stroke on this canvas owns it until it lifts, so a palm or a second
  // finger draws nothing; a stroke of a canvas that a blank pad replaced stores nothing.
  const strokeOf = (e: PointerEvent<HTMLCanvasElement>) => {
    const current = stroke.current;
    return current?.canvas === e.currentTarget && current.pointerId === e.pointerId ? current : null;
  };
  const startStroke = (e: PointerEvent<HTMLCanvasElement>) => {
    if (e.button !== 0 || stroke.current?.canvas === e.currentTarget) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    e.preventDefault();
    const pen = e.currentTarget.getContext('2d')!;
    const ink = getComputedStyle(e.currentTarget).getPropertyValue('--color-paper-ink').trim();
    pen.setTransform(ratio, 0, 0, ratio, 0, 0);
    pen.lineWidth = LINE_WIDTH;
    pen.lineCap = 'round';
    pen.lineJoin = 'round';
    pen.strokeStyle = ink;
    pen.fillStyle = ink;
    const { x, y } = pointOf(e);
    // A dot, so a tap (the dot on an i) leaves ink too.
    pen.beginPath();
    pen.arc(x, y, LINE_WIDTH / 2, 0, 2 * Math.PI);
    pen.fill();
    stroke.current = { canvas: e.currentTarget, pointerId: e.pointerId, x, y };
  };
  const extendStroke = (e: PointerEvent<HTMLCanvasElement>) => {
    const last = strokeOf(e);
    if (!last) return;
    const pen = e.currentTarget.getContext('2d')!;
    const { x, y } = pointOf(e);
    pen.beginPath();
    pen.moveTo(last.x, last.y);
    pen.lineTo(x, y);
    pen.stroke();
    stroke.current = { ...last, x, y };
  };
  const endStroke = (e: PointerEvent<HTMLCanvasElement>) => {
    if (!strokeOf(e)) return;
    stroke.current = null;
    const url = e.currentTarget.toDataURL('image/png');
    setDrawn(url);
    onChange(url);
  };

  const hintId = `${controlId}-hint`;
  return (
    <div className="flex flex-col items-start gap-1.5">
      <canvas
        key={padKey}
        ref={padRef}
        id={controlId}
        // Focusable for the hand-over after Clear, but no tab stop: the pad cannot be used from the keyboard.
        tabIndex={-1}
        role="img"
        aria-labelledby={labelId}
        aria-describedby={describedBy(hintId, describedById, errorId)}
        aria-invalid={state.invalid || undefined}
        width={PAD_WIDTH * ratio}
        height={PAD_HEIGHT * ratio}
        style={{ maxWidth: PAD_WIDTH }}
        className="h-auto w-full touch-none rounded-input border border-border bg-paper"
        onPointerDown={startStroke}
        onPointerMove={extendStroke}
        onPointerUp={endStroke}
        onPointerCancel={endStroke}
        onLostPointerCapture={endStroke}
      />
      <div className="flex w-full items-center justify-between gap-2" style={{ maxWidth: PAD_WIDTH }}>
        <span id={hintId} className="text-xs text-textMuted">
          {tc('ui.signature.hint')}
        </span>
        {stored && clear}
      </div>
    </div>
  );
}
