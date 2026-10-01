import { useEffect, useSyncExternalStore } from 'react';
import { MODE_CYCLE, SegmentedControl, Select } from '@digitaplatform/components';
import { getRuntimeSignatures, subscribeRuntimeSignatures, type Density, type ThemeMode } from '@digitaplatform/theme';
import { useThemeStore } from '@/stores/theme';
import { useChrome } from '@/lib/chrome-i18n';
import { useDesignList } from '@/components/layout/DesignMenu';
import { DENSITY_OPTIONS } from '@/components/layout/DensityMenu';
// The pinned plugin set is the only place that names the designs the platform
// ships but this session may not have loaded (premium ones arrive only with an
// entitlement), so the picker can show them as absent instead of hiding them.
import pluginsLock from '../../../../../plugins.lock.json';

const LOCKED_DESIGN_IDS = [...Object.keys(pluginsLock.free), ...Object.keys(pluginsLock.premium)];

/**
 * The showcase's control bar. Design, mode and density write through the theme
 * store, the same path the top bar menus take, so the page shows exactly what the
 * app shows and the choice roams like any other identity preference. A signature
 * is the tenant's, so it is only previewed here, until the showcase closes.
 */
export function DesignControls() {
  const tc = useChrome();
  const { design, mode, density, signature, setDesign, setMode, setDensity, previewSignature } = useThemeStore();
  const designs = useDesignList();
  const signatures = useSyncExternalStore(subscribeRuntimeSignatures, getRuntimeSignatures, getRuntimeSignatures);
  // The tenant's look comes back when the showcase closes, so a preview never follows the reviewer.
  useEffect(() => () => useThemeStore.getState().reapplySignature(), []);

  const designOptions = [
    ...designs.map((d) => ({ value: d.id, label: d.name })),
    ...LOCKED_DESIGN_IDS.filter((id) => !designs.some((d) => d.id === id)).map((id) => ({
      value: id,
      label: `${id} (not loaded)`,
      disabled: true,
    })),
  ];

  return (
    <div className="flex flex-wrap items-end gap-4">
      {/* Design, mode and density write the reviewer's own preferences: the theme store persists
          them and roams them to every device, as the top bar menus do. Said on screen, so a
          review that cycles through every design does not leave the account on the last one by
          surprise. */}
      <p className="basis-full text-sm text-textMuted">
        These controls change your own design, mode and density, on every device; set them back when
        you are done. A signature is only previewed here: the tenant's look returns when you leave.
      </p>
      <div className="w-56">
        <Select
          label={tc('ui.design.label')}
          value={design}
          onChange={setDesign}
          options={designOptions}
        />
      </div>
      <SegmentedControl
        aria-label={tc('ui.theme.toggle')}
        value={mode}
        onChange={(value) => setMode(value as ThemeMode)}
        options={MODE_CYCLE.map((m) => ({ value: m, label: m }))}
      />
      <SegmentedControl
        aria-label={tc('ui.density.label')}
        value={density}
        onChange={(value) => setDensity(value as Density)}
        options={DENSITY_OPTIONS.map((d) => ({ value: d, label: tc(`ui.density.${d}`) }))}
      />
      <div className="w-56">
        <Select
          label={tc('ui.signature.label')}
          value={signature}
          onChange={previewSignature}
          options={signatures.map((s) => ({ value: s.id, label: s.name }))}
        />
      </div>
    </div>
  );
}
