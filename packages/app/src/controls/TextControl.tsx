import { useLayoutEffect, useRef, type KeyboardEvent } from 'react';
import DOMPurify from 'dompurify';
import type { FieldControlProps } from '@/controls/types';
import { TEXTAREA_CLASS, describedBy } from '@/controls/control-styles';

/** Multi-line text (also SmallText, with fewer rows). */
export default function TextControl({
  field,
  value,
  state,
  onChange,
  controlId,
  labelId,
  describedById,
  errorId,
}: FieldControlProps) {
  const rows = field.fieldtype === 'SmallText' ? 2 : 4;
  return (
    <textarea
      data-ui="input"
      id={controlId}
      rows={rows}
      className={TEXTAREA_CLASS}
      aria-labelledby={labelId}
      aria-describedby={describedBy(describedById, errorId)}
      aria-required={state.required || undefined}
      aria-invalid={state.invalid || undefined}
      readOnly={state.readOnly}
      placeholder={field.placeholder}
      value={value == null ? '' : String(value)}
      onChange={(e) => onChange(e.target.value === '' ? undefined : e.target.value)}
    />
  );
}

/** TextEditor: the stored HTML drawn as formatted text and edited in place, so a person
 *  never sees or types tags; it stores HTML. The HTML loaded into the box and the HTML it
 *  stores keep formatting only (RICH_TEXT). */
export function TextEditorControl({
  value,
  state,
  onChange,
  controlId,
  labelId,
  describedById,
  errorId,
}: FieldControlProps) {
  const box = useRef<HTMLDivElement>(null);
  // The HTML this editor emitted last. Writing it back would move the caret to the start
  // while the person types, so only a value that came from elsewhere replaces the content.
  const emitted = useRef<string | undefined>(undefined);
  const html = value == null ? '' : String(value);
  useLayoutEffect(() => {
    if (html === emitted.current) return;
    box.current!.innerHTML = drawnRichText.sanitize(html, RICH_TEXT);
    emitted.current = undefined;
  }, [html]);
  return (
    <div
      ref={box}
      data-ui="input"
      id={controlId}
      role="textbox"
      aria-multiline="true"
      contentEditable={!state.readOnly}
      tabIndex={0}
      className={`${TEXTAREA_CLASS} overflow-y-auto ${RICH_TEXT_CLASS}`}
      aria-labelledby={labelId}
      aria-describedby={describedBy(describedById, errorId)}
      aria-required={state.required || undefined}
      aria-invalid={state.invalid || undefined}
      aria-readonly={state.readOnly || undefined}
      onInput={(e) => {
        const next = DOMPurify.sanitize(e.currentTarget.innerHTML, RICH_TEXT);
        // An editor emptied by the person still holds a line break the browser leaves behind.
        const stored = e.currentTarget.textContent === '' ? undefined : next;
        emitted.current = stored ?? '';
        onChange(stored);
      }}
    />
  );
}

/** What a TextEditor value may draw: text blocks, emphasis and links. Any person who may
 *  write the field writes HTML that everyone who opens the record sees, so style, class
 *  and data attributes (which can lay a fake page over the app), forms and images (which
 *  can send what a reader types or opens to an outside host) are dropped. */
const RICH_TEXT = {
  ALLOWED_TAGS: [
    'p', 'div', 'br', 'b', 'strong', 'i', 'em', 'u', 's', 'ul', 'ol', 'li',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'code', 'pre', 'hr', 'a', 'span',
  ],
  ALLOWED_ATTR: ['href'],
  ALLOW_DATA_ATTR: false,
  ALLOW_ARIA_ATTR: false,
};

/** A link drawn in a TextEditor opens a new tab, as a Markdown preview link does, so a
 *  reader never navigates the record page away. Its own instance keeps the hook off every
 *  other sanitize, and off the stored value, which keeps what the person wrote. */
const drawnRichText = DOMPurify(window);
drawnRichText.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName !== 'A') return;
  node.setAttribute('target', '_blank');
  node.setAttribute('rel', 'noopener noreferrer');
});

/** Code: the plain text in a monospace area that does not wrap or check spelling, so
 *  columns line up, and Enter starts the next line at the indentation of the current one. */
export function CodeControl({
  field,
  value,
  state,
  onChange,
  controlId,
  labelId,
  describedById,
  errorId,
}: FieldControlProps) {
  const emit = (text: string) => onChange(text === '' ? undefined : text);
  return (
    <textarea
      data-ui="input"
      id={controlId}
      rows={6}
      className={`${TEXTAREA_CLASS} font-mono`}
      wrap="off"
      spellCheck={false}
      aria-labelledby={labelId}
      aria-describedby={describedBy(describedById, errorId)}
      aria-required={state.required || undefined}
      aria-invalid={state.invalid || undefined}
      readOnly={state.readOnly}
      placeholder={field.placeholder}
      value={value == null ? '' : String(value)}
      onKeyDown={(e) => continueIndentation(e, emit)}
      onChange={(e) => emit(e.target.value)}
    />
  );
}

function continueIndentation(e: KeyboardEvent<HTMLTextAreaElement>, emit: (text: string) => void): void {
  if (e.key !== 'Enter' || e.shiftKey || e.ctrlKey || e.metaKey || e.altKey || e.nativeEvent.isComposing) return;
  const box = e.currentTarget;
  if (box.readOnly) return;
  const lineStart = box.value.lastIndexOf('\n', box.selectionStart - 1) + 1;
  const indentation = /^[ \t]*/.exec(box.value.slice(lineStart, box.selectionStart))![0];
  if (!indentation) return;
  e.preventDefault();
  box.setRangeText(`\n${indentation}`, box.selectionStart, box.selectionEnd, 'end');
  emit(box.value);
}

/** Markdown: the source in a text area, as stored, with its rendered preview below, so a
 *  person sees the result of the markup they type. */
export function MarkdownControl(props: FieldControlProps) {
  const source = props.value == null ? '' : String(props.value);
  return (
    <div className="flex flex-col gap-2">
      <TextControl {...props} />
      <div
        data-ui="markdown-preview"
        className={`${PREVIEW_CLASS} ${RICH_TEXT_CLASS}`}
        dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(renderMarkdown(source), { ADD_ATTR: ['target'] }) }}
      />
    </div>
  );
}

const PREVIEW_CLASS = 'min-h-[5.5rem] max-h-[20rem] overflow-y-auto rounded-input border border-border bg-subtle px-3 py-2.5';

/** The base styles reset headings, lists and links to plain text, so rich content
 *  gets its own. */
const RICH_TEXT_CLASS =
  'text-sm text-textMain [&_h1]:text-lg [&_h1]:font-semibold [&_h2]:text-base [&_h2]:font-semibold ' +
  '[&_h3]:font-semibold [&_h4]:font-semibold [&_h5]:font-semibold [&_h6]:font-semibold ' +
  '[&_p]:my-2 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 ' +
  '[&_blockquote]:my-2 [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:text-textMuted ' +
  '[&_code]:font-mono [&_code]:text-xs [&_pre]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded [&_pre]:bg-surface [&_pre]:p-2 ' +
  '[&_a]:text-primaryText [&_a]:underline [&_hr]:my-3 [&_hr]:border-border';

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Spans inside one block. Code spans and links are set aside first, so the emphasis
 *  rules never reach into their text or address. */
function renderInline(text: string): string {
  const setAside: string[] = [];
  const keep = (html: string) => `\uE000${setAside.push(html) - 1}\uE000`;
  // A placeholder character in the source is written as its reference, so only keep() makes
  // placeholders and each one names an earlier, existing entry.
  const html = escapeHtml(text)
    .replace(/\uE000/g, '&#xE000;')
    .replace(/`([^`]+)`/g, (_, code: string) => keep(`<code>${code}</code>`))
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label: string, href: string) =>
      keep(`<a href="${href}" target="_blank" rel="noopener noreferrer">${label}</a>`),
    )
    .replace(/\*\*(.+?)\*\*|(?<!\w)__(.+?)__(?!\w)/g, (_, starred?: string, underscored?: string) => `<strong>${starred ?? underscored}</strong>`)
    .replace(/\*(.+?)\*|(?<!\w)_(.+?)_(?!\w)/g, (_, starred?: string, underscored?: string) => `<em>${starred ?? underscored}</em>`)
    .replace(/~~(.+?)~~/g, '<del>$1</del>')
    .replace(/ {2,}\n/g, '<br>\n');
  const restore = (part: string): string => part.replace(/\uE000(\d+)\uE000/g, (_, index: string) => restore(setAside[Number(index)]!));
  return restore(html);
}

const FENCE = /^\s*(`{3,}|~{3,})/;
const HEADING = /^(#{1,6})\s/;
const RULE = /^\s*([-*_])(\s*\1){2,}\s*$/;
const QUOTE = /^\s*>/;
const LIST_ITEM = /^\s*([-*+]|\d+[.)])\s+(.*)$/;

function startsBlock(line: string): boolean {
  return FENCE.test(line) || HEADING.test(line) || RULE.test(line) || QUOTE.test(line) || LIST_ITEM.test(line);
}

/** The HTML of the common Markdown blocks (headings, paragraphs, flat lists, quotes, fenced
 *  code, rules) and spans (strong, emphasis, code, links, strikethrough). Raw HTML in the
 *  source is escaped, so it shows as the text the person typed. */
function renderMarkdown(source: string): string {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const blocks: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (!line.trim()) {
      i++;
      continue;
    }
    const fence = FENCE.exec(line);
    if (fence) {
      const code: string[] = [];
      for (i++; i < lines.length && !lines[i]!.trimStart().startsWith(fence[1]!); i++) code.push(lines[i]!);
      i++;
      blocks.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`);
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      const level = heading[1]!.length;
      // A closing run of # is markup. The lookbehind lets only the start of a run try to reach
      // the end of the line, so a long line costs one pass, never a pass per space.
      const text = line.slice(level).trim().replace(/(?<!#)#+$/, '').trimEnd();
      blocks.push(`<h${level}>${renderInline(text)}</h${level}>`);
      i++;
      continue;
    }
    if (RULE.test(line)) {
      blocks.push('<hr>');
      i++;
      continue;
    }
    if (QUOTE.test(line)) {
      const quoted: string[] = [];
      for (; i < lines.length && QUOTE.test(lines[i]!); i++) quoted.push(lines[i]!.replace(/^\s*>\s?/, ''));
      blocks.push(`<blockquote>${renderMarkdown(quoted.join('\n'))}</blockquote>`);
      continue;
    }
    const first = LIST_ITEM.exec(line);
    if (first) {
      const ordered = /\d/.test(first[1]!);
      const items: string[] = [];
      for (; i < lines.length; i++) {
        const item = LIST_ITEM.exec(lines[i]!);
        if (item && /\d/.test(item[1]!) === ordered) items.push(item[2]!);
        else if (!item && /^\s+\S/.test(lines[i]!)) items[items.length - 1] += `\n${lines[i]!.trim()}`;
        else break;
      }
      const tag = ordered ? 'ol' : 'ul';
      const start = ordered ? parseInt(first[1]!, 10) : 1;
      blocks.push(`<${tag}${start !== 1 ? ` start="${start}"` : ''}>${items.map((t) => `<li>${renderInline(t)}</li>`).join('')}</${tag}>`);
      continue;
    }
    const paragraph: string[] = [];
    for (; i < lines.length && lines[i]!.trim() && !startsBlock(lines[i]!); i++) paragraph.push(lines[i]!);
    blocks.push(`<p>${renderInline(paragraph.join('\n'))}</p>`);
  }
  return blocks.join('\n');
}
