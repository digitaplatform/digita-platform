import type { FrontendPlugin } from '@digitaplatform/plugins';
import { AppMenu } from './AppMenu';

/** The app's left menu, a built-in plugin a layout places in its `left` region. */
const appMenu: FrontendPlugin = { id: 'app-menu', title: 'Navigation', component: AppMenu };

export default appMenu;
