import { useRef, useState } from 'react';
import { ChevronDown, Check, Star, Building2, Trash2, Save, Plus, Users, RotateCcw, ListX } from 'lucide-react';
import { Button, Input, Select, IconButton } from '@digitaplatform/components';
import { useChrome } from '@/lib/chrome-i18n';
import { useFocusTrap } from '@/lib/use-focus-trap';
import { tid } from '@/lib/testid';
import type { ListPreferenceDoc, ViewVisibility } from '@/services/listPreference';

/**
 * Saved-views dropdown. PURE: list, active id, and every action come via props.
 * A view is applied by reference (the page keeps the URL clean); editing forks it
 * (`modified`), enabling Save (overwrite) / Save as / Reset. Sharing: private /
 * shared with roles+users / everyone. Edit/delete + my-default are shown only for
 * views the user owns (`canEdit`); the org default is admin-only.
 */

const truthy = (v: unknown) => v === 1 || v === true;
const parseCsv = (s: string): string[] => s.split(',').map((x) => x.trim()).filter(Boolean);

export interface ViewPickerProps {
  views: ListPreferenceDoc[];
  activeId?: string;
  /** The applied view has unsaved edits. */
  modified?: boolean;
  /** Whether there is state worth saving (enables Save / Save as). */
  canSave?: boolean;
  isAdmin?: boolean;
  canEdit: (v: ListPreferenceDoc) => boolean;
  onApply: (id: string) => void;
  onReset: () => void;
  onAllRecords: () => void;
  onSaveAs: (name: string, visibility: ViewVisibility, roles: string[], users: string[]) => void;
  onUpdate: (id: string) => void;
  onDelete: (id: string) => void;
  onSetDefault: (id: string) => void;
  onClearDefault: (id: string) => void;
  onSetOrgDefault: (id: string) => void;
  onClearOrgDefault: (id: string) => void;
}

export function ViewPicker({
  views,
  activeId,
  modified = false,
  canSave = true,
  isAdmin = false,
  canEdit,
  onApply,
  onReset,
  onAllRecords,
  onSaveAs,
  onUpdate,
  onDelete,
  onSetDefault,
  onClearDefault,
  onSetOrgDefault,
  onClearOrgDefault,
}: ViewPickerProps) {
  const tc = useChrome();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [visibility, setVisibility] = useState<ViewVisibility>('private');
  const [rolesCsv, setRolesCsv] = useState('');
  const [usersCsv, setUsersCsv] = useState('');
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(panelRef, open);

  const active = views.find((v) => v._id === activeId);

  function close(): void {
    setOpen(false);
    setSaving(false);
    setDraftName('');
    setVisibility('private');
    setRolesCsv('');
    setUsersCsv('');
  }

  function commitSaveAs(): void {
    const name = draftName.trim();
    if (!name) return;
    onSaveAs(name, visibility, parseCsv(rolesCsv), parseCsv(usersCsv));
    close();
  }

  return (
    <div className="relative">
      <Button
        type="button"
        variant="secondary"
        size="sm"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => (open ? close() : setOpen(true))}
        className="max-w-[14rem]"
        {...tid.view('menu')}
      >
        <span className="truncate">
          {active ? active.view_name : tc('ui.view.menu')}
          {active && modified ? ' •' : ''}
        </span>
        <ChevronDown className="h-4 w-4 shrink-0" aria-hidden="true" />
      </Button>

      {open && (
        <>
          <div className="fixed inset-0 z-30" aria-hidden="true" onClick={close} />
          <div
            ref={panelRef}
            role="menu"
            aria-label={tc('ui.view.menu')}
            className="anim-pop-in absolute right-0 z-40 mt-2 w-80 rounded-dialog border border-border bg-surfaceGlass p-2 shadow-lg backdrop-blur-md"
          >
            {/* Modified banner: discard edits back to the clean view. */}
            {active && modified && (
              <div className="mb-1 flex items-center justify-between gap-2 rounded-md bg-bgHover px-2 py-1.5 text-xs text-textMuted">
                <span>{tc('ui.view.modified')}</span>
                <button
                  type="button"
                  onClick={() => {
                    onReset();
                    close();
                  }}
                  className="inline-flex items-center gap-1 font-medium text-primary-600 hover:underline"
                >
                  <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                  {tc('ui.view.reset')}
                </button>
              </div>
            )}

            {/* All records — leave any applied view. */}
            <button
              type="button"
              role="menuitemradio"
              aria-checked={!activeId}
              onClick={() => {
                onAllRecords();
                close();
              }}
              className="mb-1 flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm text-textMain transition-colors duration-base ease-smooth hover:bg-bgHover"
              {...tid.view('all')}
            >
              {!activeId ? (
                <Check className="h-4 w-4 shrink-0 text-primary-600" aria-hidden="true" />
              ) : (
                <ListX className="h-4 w-4 shrink-0 text-textMuted" aria-hidden="true" />
              )}
              <span>{tc('ui.view.allRecords')}</span>
            </button>

            {views.length > 0 && (
              <ul className="mb-1 max-h-64 overflow-auto border-t border-border pt-1">
                {views.map((v) => {
                  const isActive = v._id === activeId;
                  const mineDefault = truthy(v.is_default);
                  const orgDefault = truthy(v.is_org_default);
                  const editable = canEdit(v);
                  return (
                    <li key={v._id} className="group flex items-center gap-0.5 rounded-md px-1 hover:bg-bgHover">
                      <button
                        type="button"
                        role="menuitemradio"
                        aria-checked={isActive}
                        onClick={() => {
                          onApply(v._id);
                          close();
                        }}
                        className="flex flex-1 items-center gap-2 truncate py-2 pl-1 text-left text-sm text-textMain"
                        {...tid.view('apply', v._id)}
                      >
                        {isActive ? (
                          <Check className="h-4 w-4 shrink-0 text-primary-600" aria-hidden="true" />
                        ) : (
                          <span className="h-4 w-4 shrink-0" aria-hidden="true" />
                        )}
                        <span className="truncate">{v.view_name}</span>
                        {v.visibility && v.visibility !== 'private' && (
                          <Users className="h-3.5 w-3.5 shrink-0 text-textMuted" aria-label={tc('ui.view.shared')} />
                        )}
                        {orgDefault && (
                          <Building2 className="h-3.5 w-3.5 shrink-0 text-textMuted" aria-label={tc('ui.view.orgDefault')} />
                        )}
                      </button>

                      {/* My default (owner only) */}
                      {editable && (
                        <IconButton
                          size="sm"
                          aria-pressed={mineDefault}
                          label={
                            mineDefault
                              ? tc('ui.view.clearDefault', { name: v.view_name })
                              : tc('ui.view.setDefault', { name: v.view_name })
                          }
                          onClick={() => (mineDefault ? onClearDefault(v._id) : onSetDefault(v._id))}
                          {...tid.view('default', v._id)}
                          icon={
                            <Star
                              className={'h-4 w-4 ' + (mineDefault ? 'fill-primary-600 text-primary-600' : '')}
                              aria-hidden="true"
                            />
                          }
                        />
                      )}

                      {/* Org default (admin only) */}
                      {isAdmin && (
                        <IconButton
                          size="sm"
                          aria-pressed={orgDefault}
                          label={
                            orgDefault
                              ? tc('ui.view.clearOrgDefault', { name: v.view_name })
                              : tc('ui.view.setOrgDefault', { name: v.view_name })
                          }
                          onClick={() => (orgDefault ? onClearOrgDefault(v._id) : onSetOrgDefault(v._id))}
                          {...tid.view('org-default', v._id)}
                          icon={
                            <Building2
                              className={'h-4 w-4 ' + (orgDefault ? 'text-primary-600' : '')}
                              aria-hidden="true"
                            />
                          }
                        />
                      )}

                      {/* Overwrite with current edits (owner only, when modified) */}
                      {isActive && modified && canSave && editable && (
                        <IconButton
                          size="sm"
                          label={tc('ui.view.update', { name: v.view_name })}
                          onClick={() => {
                            onUpdate(v._id);
                            close();
                          }}
                          {...tid.view('update', v._id)}
                          icon={<Save className="h-4 w-4" aria-hidden="true" />}
                        />
                      )}

                      {/* Delete (owner only) */}
                      {editable && (
                        <IconButton
                          size="sm"
                          variant="danger"
                          label={tc('ui.view.delete', { name: v.view_name })}
                          onClick={() => onDelete(v._id)}
                          {...tid.view('delete', v._id)}
                          icon={<Trash2 className="h-4 w-4" aria-hidden="true" />}
                        />
                      )}
                    </li>
                  );
                })}
              </ul>
            )}

            <div className="border-t border-border pt-2">
              {!saving ? (
                <Button
                  type="button"
                  variant="ghost"
                  className="w-full justify-start text-sm"
                  disabled={!canSave}
                  onClick={() => setSaving(true)}
                  {...tid.view('save-as')}
                >
                  <Plus className="h-4 w-4" aria-hidden="true" />
                  {tc('ui.view.saveAs')}
                </Button>
              ) : (
                <div className="flex flex-col gap-2 p-1">
                  <Input
                    autoFocus
                    aria-label={tc('ui.view.name')}
                    placeholder={tc('ui.view.name')}
                    value={draftName}
                    {...tid.view('save-as-name')}
                    onChange={(e) => setDraftName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && visibility !== 'shared') commitSaveAs();
                      if (e.key === 'Escape') setSaving(false);
                    }}
                  />
                  <label className="text-xs font-medium text-textMuted">
                    {tc('ui.view.visibility')}
                    <Select
                      className="mt-1"
                      aria-label={tc('ui.view.visibility')}
                      value={visibility}
                      onChange={(v) => setVisibility(v as ViewVisibility)}
                      options={[
                        { value: 'private', label: tc('ui.view.visPrivate') },
                        { value: 'shared', label: tc('ui.view.visShared') },
                        { value: 'everyone', label: tc('ui.view.visEveryone') },
                      ]}
                    />
                  </label>
                  {visibility === 'shared' && (
                    <>
                      <Input
                        aria-label={tc('ui.view.roles')}
                        placeholder={tc('ui.view.rolesHint')}
                        value={rolesCsv}
                        onChange={(e) => setRolesCsv(e.target.value)}
                      />
                      <Input
                        aria-label={tc('ui.view.users')}
                        placeholder={tc('ui.view.usersHint')}
                        value={usersCsv}
                        onChange={(e) => setUsersCsv(e.target.value)}
                      />
                    </>
                  )}
                  <div className="flex justify-end gap-2">
                    <Button type="button" variant="ghost" className="text-sm" onClick={() => setSaving(false)}>
                      {tc('ui.action.cancel')}
                    </Button>
                    <Button type="button" className="text-sm" disabled={!draftName.trim()} onClick={commitSaveAs} {...tid.view('save-as-confirm')}>
                      {tc('ui.action.save')}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
