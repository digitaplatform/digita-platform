/** Drops the two token blocks a design plugin's dist CSS opens with,
 *  `:root[data-design="x"] {…}` and `:root[data-design="x"].dark {…}` (with or without the dark
 *  band twin of its selector), and nothing else: a rule that scopes a hook under the same attribute
 *  is a variant rule and stays. The selector is matched whole, up to its ` {`. */
export function stripPluginTokenBlocks(css) {
  return css.replace(
    /^:root\[data-design="([^"]+)"\](?:\.dark(?:,\n:root\[data-design="\1"\] \[data-block\]\[data-variant="dark"\])?)? \{[^}]*\}\s*/gm,
    '',
  );
}
