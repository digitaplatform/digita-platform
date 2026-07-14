import type { FrontendPlugin } from '@digitaplatform/plugins';
import { UserMenuNav } from './UserMenuNav';

/**
 * The usermenu plugin: a role-scoped navigation rail. The host places it into a
 * template region (e.g. the classic template's left rail) via LayoutConfig; the
 * host knows nothing about it beyond this contract.
 */
export const plugin: FrontendPlugin = {
  id: 'usermenu',
  title: 'Navigation',
  component: UserMenuNav,
};

export default plugin;
