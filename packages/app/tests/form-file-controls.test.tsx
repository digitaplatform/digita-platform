// @vitest-environment jsdom
// Attach and AttachImage upload the file a person picks and store the URL the engine answers with;
// removing a file asks first and stores null, which is what makes the engine drop it. A stored value
// that is no http(s) or relative location is never drawn as a link or an image, because every later
// viewer of the record would run it.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { FieldDefinition } from '@digitaplatform/shared';
import type { FieldControlState } from '@/controls/types';
import { FormRenderer } from '@/components/render/FormRenderer';

const uploads = vi.hoisted(() => ({ uploadFile: vi.fn() }));
const host = vi.hoisted(() => ({ confirm: vi.fn(), toast: vi.fn() }));

vi.mock('@/services/upload', () => uploads);
vi.mock('@/components/overlay/DialogHost', () => ({ useDialogHost: () => host }));
vi.mock('@/lib/chrome-i18n', () => ({ useChrome: () => (key: string) => key }));

const OPEN: FieldControlState = {
  visible: true,
  required: false,
  readOnly: false,
  invalid: false,
  isComputed: false,
  isFrozen: false,
  updating: false,
};

function buildField(fieldtype: string): FieldDefinition {
  return { fieldname: 'thing', fieldtype, label: 'Thing' } as FieldDefinition;
}

// Keeps the stored value the form receives, so a picked file shows in the control as it does on a page.
function Form({
  field,
  value,
  state,
  onFieldChange,
}: {
  field: FieldDefinition;
  value: unknown;
  state: FieldControlState;
  onFieldChange: (fieldname: string, value: unknown) => void;
}) {
  const [doc, setDoc] = useState<Record<string, unknown>>({ [field.fieldname]: value });
  return (
    <MemoryRouter>
      <FormRenderer
        entity="Gadget"
        fields={[field]}
        doc={doc}
        fieldState={{ [field.fieldname]: state }}
        errors={{}}
        onFieldChange={(fieldname, next) => {
          onFieldChange(fieldname, next);
          setDoc((previous) => ({ ...previous, [fieldname]: next }));
        }}
      />
    </MemoryRouter>
  );
}

function drawField(field: FieldDefinition, value?: unknown, state: Partial<FieldControlState> = {}) {
  const onFieldChange = vi.fn();
  render(<Form field={field} value={value} state={{ ...OPEN, ...state }} onFieldChange={onFieldChange} />);
  return onFieldChange;
}

beforeEach(() => {
  uploads.uploadFile.mockReset();
  host.confirm.mockReset();
  host.toast.mockReset();
});

describe('Attach', () => {
  const stored = 'https://files.example/invoices/invoice.pdf';

  it('draws the stored file as a link to its URL', async () => {
    drawField(buildField('Attach'), stored);
    const link = await screen.findByRole('link', { name: 'invoice.pdf' });
    expect(link).toHaveAttribute('href', stored);
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('uploads the picked file against the record and emits the URL the engine answers with', async () => {
    const user = userEvent.setup();
    uploads.uploadFile.mockResolvedValue({ _id: 'f1', file_url: '/api/v1/file/contract.pdf', file_name: 'contract.pdf' });
    const onFieldChange = drawField(buildField('Attach'), stored);
    const chooser = await screen.findByLabelText('Thing');
    const file = new File(['%PDF-1.4'], 'contract.pdf', { type: 'application/pdf' });

    await user.upload(chooser, file);

    await waitFor(() => expect(onFieldChange).toHaveBeenLastCalledWith('thing', '/api/v1/file/contract.pdf'));
    expect(uploads.uploadFile).toHaveBeenCalledWith(file, 'Gadget', { field: 'thing' });
    expect(await screen.findByRole('link', { name: 'contract.pdf' })).toHaveAttribute('href', '/api/v1/file/contract.pdf');
  });

  it('shows why an upload failed and emits no value for it', async () => {
    const user = userEvent.setup();
    uploads.uploadFile.mockRejectedValue(new Error('File too large'));
    const onFieldChange = drawField(buildField('Attach'), stored);
    await user.upload(await screen.findByLabelText('Thing'), new File(['x'], 'big.pdf', { type: 'application/pdf' }));

    expect(await screen.findByText('File too large')).toBeInTheDocument();
    expect(onFieldChange).not.toHaveBeenCalled();
    expect(screen.getByRole('link', { name: 'invoice.pdf' })).toBeInTheDocument();
  });

  it('asks before it removes the file, and emits null after a yes', async () => {
    const user = userEvent.setup();
    host.confirm.mockResolvedValue(true);
    const onFieldChange = drawField(buildField('Attach'), stored);

    await user.click(await screen.findByRole('button', { name: 'ui.attach.remove' }));

    await waitFor(() => expect(onFieldChange).toHaveBeenLastCalledWith('thing', null));
    expect(host.confirm).toHaveBeenCalledTimes(1);
    expect(host.confirm).toHaveBeenCalledWith(expect.objectContaining({ danger: true }));
    expect(screen.queryByRole('link', { name: 'invoice.pdf' })).toBeNull();
  });

  it('keeps the file when the removal is declined', async () => {
    const user = userEvent.setup();
    host.confirm.mockResolvedValue(false);
    const onFieldChange = drawField(buildField('Attach'), stored);

    await user.click(await screen.findByRole('button', { name: 'ui.attach.remove' }));

    await waitFor(() => expect(host.confirm).toHaveBeenCalledTimes(1));
    expect(onFieldChange).not.toHaveBeenCalled();
    expect(screen.getByRole('link', { name: 'invoice.pdf' })).toBeInTheDocument();
  });

  it('offers no remove button while no file is stored', async () => {
    drawField(buildField('Attach'));
    await screen.findByLabelText('Thing');
    expect(screen.queryByRole('button', { name: 'ui.attach.remove' })).toBeNull();
  });

  it('draws the file as a link without a chooser while it is read-only', async () => {
    drawField(buildField('Attach'), stored, { readOnly: true });
    const link = await screen.findByRole('link', { name: 'Thing' });
    expect(link).toHaveTextContent('invoice.pdf');
    expect(link).toHaveAttribute('href', stored);
    expect(screen.queryByRole('button')).toBeNull();
    expect(document.querySelector('input[type="file"]')).toBeNull();
  });

  it('draws a dash while it is read-only and no file is stored', async () => {
    drawField(buildField('Attach'), undefined, { readOnly: true });
    expect(await screen.findByText('—')).toBeInTheDocument();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it.each([
    ['read-only', { readOnly: true }],
    ['editable', {}],
  ])('draws a stored javascript: value as plain text, never as a link, while %s', async (_mode, state) => {
    drawField(buildField('Attach'), 'javascript:alert(1)', state);
    expect(await screen.findByText('javascript:alert(1)')).toBeInTheDocument();
    expect(screen.queryByRole('link')).toBeNull();
  });
});

describe('a required upload field', () => {
  it.each(['Attach', 'AttachImage'])('%s tells a screen reader that its chooser is required', async (fieldtype) => {
    drawField(buildField(fieldtype), undefined, { required: true });
    expect(await screen.findByRole('button', { name: 'ui.attach.choose', description: /ui\.field\.required/ })).toBeInTheDocument();
  });

  it.each(['Attach', 'AttachImage'])('%s says nothing of required on an optional chooser', async (fieldtype) => {
    drawField(buildField(fieldtype));
    expect(await screen.findByRole('button', { name: 'ui.attach.choose' })).not.toHaveAccessibleDescription(/ui\.field\.required/);
  });
});

describe('AttachImage', () => {
  const stored = 'https://files.example/photos/bike.png';

  it('draws the stored file as a picture with the file name beside it', async () => {
    drawField(buildField('AttachImage'), stored);
    const picture = await screen.findByRole('img', { name: 'Thing' });
    expect(picture).toHaveAttribute('src', stored);
    expect(screen.getByText('bike.png')).toBeInTheDocument();
  });

  it('uploads the picked image against the record and emits the URL the engine answers with', async () => {
    const user = userEvent.setup();
    uploads.uploadFile.mockResolvedValue({ _id: 'f2', file_url: '/api/v1/file/frame.png', file_name: 'frame.png' });
    const onFieldChange = drawField(buildField('AttachImage'), stored);
    const file = new File(['png'], 'frame.png', { type: 'image/png' });

    await user.upload(await screen.findByLabelText('Thing'), file);

    await waitFor(() => expect(onFieldChange).toHaveBeenLastCalledWith('thing', '/api/v1/file/frame.png'));
    expect(uploads.uploadFile).toHaveBeenCalledWith(file, 'Gadget', { field: 'thing' });
    expect(await screen.findByRole('img', { name: 'Thing' })).toHaveAttribute('src', '/api/v1/file/frame.png');
  });

  it('offers only images to the file chooser', async () => {
    drawField(buildField('AttachImage'));
    expect(await screen.findByLabelText('Thing')).toHaveAttribute('accept', 'image/*');
  });

  it('shows why an upload failed and emits no value for it', async () => {
    const user = userEvent.setup();
    uploads.uploadFile.mockRejectedValue(new Error('Not an image'));
    const onFieldChange = drawField(buildField('AttachImage'), stored);
    await user.upload(await screen.findByLabelText('Thing'), new File(['x'], 'notes.png', { type: 'image/png' }));

    expect(await screen.findByText('Not an image')).toBeInTheDocument();
    expect(onFieldChange).not.toHaveBeenCalled();
    expect(screen.getByRole('img', { name: 'Thing' })).toHaveAttribute('src', stored);
  });

  it('asks before it removes the image, and emits null after a yes', async () => {
    const user = userEvent.setup();
    host.confirm.mockResolvedValue(true);
    const onFieldChange = drawField(buildField('AttachImage'), stored);

    await user.click(await screen.findByRole('button', { name: 'ui.attach.remove' }));

    await waitFor(() => expect(onFieldChange).toHaveBeenLastCalledWith('thing', null));
    expect(host.confirm).toHaveBeenCalledWith(expect.objectContaining({ danger: true }));
    expect(screen.queryByRole('img', { name: 'Thing' })).toBeNull();
  });

  it('keeps the image when the removal is declined', async () => {
    const user = userEvent.setup();
    host.confirm.mockResolvedValue(false);
    const onFieldChange = drawField(buildField('AttachImage'), stored);

    await user.click(await screen.findByRole('button', { name: 'ui.attach.remove' }));

    await waitFor(() => expect(host.confirm).toHaveBeenCalledTimes(1));
    expect(onFieldChange).not.toHaveBeenCalled();
    expect(screen.getByRole('img', { name: 'Thing' })).toBeInTheDocument();
  });

  it('draws the picture without a chooser while it is read-only', async () => {
    drawField(buildField('AttachImage'), stored, { readOnly: true });
    expect(await screen.findByRole('img', { name: 'Thing' })).toHaveAttribute('src', stored);
    expect(screen.queryByRole('button')).toBeNull();
    expect(document.querySelector('input[type="file"]')).toBeNull();
  });

  it('draws a dash while it is read-only and no image is stored', async () => {
    drawField(buildField('AttachImage'), undefined, { readOnly: true });
    expect(await screen.findByText('—')).toBeInTheDocument();
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('draws a dash, never a picture, for a stored javascript: value while read-only', async () => {
    drawField(buildField('AttachImage'), 'javascript:alert(1)', { readOnly: true });
    expect(await screen.findByText('—')).toBeInTheDocument();
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('draws no picture for a stored javascript: value while editable', async () => {
    drawField(buildField('AttachImage'), 'javascript:alert(1)');
    // The chooser is what shows the control has been drawn.
    await screen.findByLabelText('Thing');
    expect(screen.queryByRole('img')).toBeNull();
  });
});
