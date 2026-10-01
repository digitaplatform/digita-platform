// @vitest-environment jsdom
// A plugin reads every text through the host's t(). Its ui.* keys are the app's chrome texts
// (digita-app), which the engine's data texts in the i18n store do not hold.
import { afterEach, describe, expect, it } from 'vitest';
import { useHost } from '@digitaplatform/plugins';
import { readBundle } from '@digitaplatform/shared/i18n-node';
import { installHostServices } from '@/plugins/host-services';
import { useI18nStore } from '@/stores/i18n';

// tests/setup.ts stops the run without it.
const texts = readBundle(process.env.TRANSLATIONS_DIR!);

afterEach(() => {
  useI18nStore.setState({ locale: 'en', translations: {} });
});

describe("the host's t for plugins", () => {
  it('answers a ui.* key with the chrome text', () => {
    installHostServices();
    expect(useHost().t('ui.usermenu.empty')).toBe(texts.en!['ui.usermenu.empty']);
  });

  it('answers a ui.* key in the session language', () => {
    useI18nStore.setState({ locale: 'de' });
    installHostServices();
    expect(useHost().t('ui.usermenu.empty')).toBe(texts.de!['ui.usermenu.empty']);
  });

  it('still answers a data key from the i18n store', () => {
    useI18nStore.setState({ translations: { 'entity.Customer': 'Kunde' } });
    installHostServices();
    expect(useHost().t('entity.Customer')).toBe('Kunde');
  });
});
