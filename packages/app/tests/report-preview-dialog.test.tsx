// @vitest-environment jsdom
// ReportPreviewDialog is the frame that every print button of the app opens: the report inside an
// iframe, a link that opens the self-printing variant, and a link per export format. The caller hands
// it ready-made addresses, so the dialog has to draw exactly those, or the receptionist gets a blank
// preview or a link to the wrong document. It lives in the components package and is drawn here the
// way the app draws it.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReportPreviewDialog } from '@digitaplatform/components';

const SRC = 'https://reports.example/api/v1/report/definitions/invoice/render?format=html&invoice=INV-7';
const PRINT_HREF = `${SRC}&print=1`;
const PDF_HREF = 'https://reports.example/api/v1/report/definitions/invoice/render?format=pdf&invoice=INV-7';
const PNG_HREF = 'https://reports.example/api/v1/report/definitions/invoice/render?format=png&invoice=INV-7';

let windowOpen: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  windowOpen = vi.spyOn(window, 'open').mockImplementation(() => null);
});

afterEach(() => {
  vi.restoreAllMocks();
});

function drawPreview(props: Partial<React.ComponentProps<typeof ReportPreviewDialog>> = {}) {
  const onClose = vi.fn();
  render(
    <ReportPreviewDialog
      open
      onClose={onClose}
      title="Invoice INV-7"
      src={SRC}
      printHref={PRINT_HREF}
      downloads={[
        { label: 'PDF', href: PDF_HREF },
        { label: 'PNG', href: PNG_HREF },
      ]}
      {...props}
    />,
  );
  return onClose;
}

describe('ReportPreviewDialog', () => {
  it('draws a dialog with the title and the report in a frame on the address it is given', () => {
    drawPreview();
    const dialog = screen.getByRole('dialog', { name: 'Invoice INV-7' });
    const frame = within(dialog).getByTestId('report-preview:iframe');
    expect(frame.tagName).toBe('IFRAME');
    expect(frame).toHaveAttribute('src', SRC);
    expect(frame).toHaveAttribute('title', 'Invoice INV-7');
  });

  it('draws nothing while it is closed', () => {
    drawPreview({ open: false });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByTestId('report-preview:iframe')).toBeNull();
  });

  it('opens the self-printing address in a new tab from the print link', async () => {
    const user = userEvent.setup();
    drawPreview();

    await user.click(screen.getByTestId('report-preview:print'));

    expect(windowOpen).toHaveBeenCalledTimes(1);
    expect(windowOpen).toHaveBeenCalledWith(PRINT_HREF, '_blank', 'noopener');
  });

  it('draws no print link when the caller gives no address for it', () => {
    drawPreview({ printHref: undefined });
    expect(screen.queryByTestId('report-preview:print')).toBeNull();
  });

  it('draws a link per format, named by its label, and opens each address in a new tab', async () => {
    const user = userEvent.setup();
    drawPreview();
    const formats = screen.getAllByTestId(/^report-preview:download:/);
    expect(formats.map((link) => link.textContent)).toEqual(['PDF', 'PNG']);

    await user.click(screen.getByTestId('report-preview:download:pdf'));
    expect(windowOpen).toHaveBeenLastCalledWith(PDF_HREF, '_blank', 'noopener');

    await user.click(screen.getByTestId('report-preview:download:png'));
    expect(windowOpen).toHaveBeenLastCalledWith(PNG_HREF, '_blank', 'noopener');
    expect(windowOpen).toHaveBeenCalledTimes(2);
  });

  it('draws no format link when the caller gives no formats', () => {
    drawPreview({ downloads: undefined });
    expect(screen.queryAllByTestId(/^report-preview:download:/)).toHaveLength(0);
    expect(screen.getByTestId('report-preview:print')).toBeInTheDocument();
  });

  it('opens the address of the frame in a new tab', async () => {
    const user = userEvent.setup();
    drawPreview();

    await user.click(screen.getByTestId('report-preview:open'));

    expect(windowOpen).toHaveBeenCalledWith(SRC, '_blank', 'noopener');
  });

  it('reloads the frame by drawing a fresh one on the same address', async () => {
    const user = userEvent.setup();
    drawPreview();
    const before = screen.getByTestId('report-preview:iframe');
    fireEvent.load(before);

    await user.click(screen.getByTestId('report-preview:reload'));

    const after = screen.getByTestId('report-preview:iframe');
    expect(after).not.toBe(before);
    expect(after).toHaveAttribute('src', SRC);
  });

  it('tells its caller when it is closed', async () => {
    const user = userEvent.setup();
    const onClose = drawPreview();

    await user.keyboard('{Escape}');

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
