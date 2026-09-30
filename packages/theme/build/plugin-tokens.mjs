import { DARK_BAND_SELECTOR } from '../dist/index.js';

const BAND = DARK_BAND_SELECTOR.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const TOKEN_BLOCK = new RegExp(
  `^:root\\[data-design="([^"]+)"\\](?:\\.dark(?:,\\n:root\\[data-design="\\1"\\] ${BAND})?)? \\{[^}]*\\}\\s*`,
  'gm',
);

/** Drops the two token blocks a design plugin's dist CSS opens with,
 *  `:root[data-design="x"] {…}` and `:root[data-design="x"].dark {…}` (with or without the dark
 *  band twin of its selector), and nothing else: a rule that scopes a hook under the same attribute
 *  is a variant rule and stays. The selector is matched whole, up to its ` {`. */
export function stripPluginTokenBlocks(css) {
  return css.replace(TOKEN_BLOCK, '');
}
