import { bootIdentity, readPageIdentity } from './boot-identity.js';

/**
 * The pre-paint entry of a server-rendered page, built as a classic script
 * (dist/identity-boot.js) that the page inlines in its <head>. It runs
 * bootIdentity with the data the server wrote into the page (readPageIdentity).
 * The mode class is set once; the page's own runtime follows the OS afterwards.
 */
const data = readPageIdentity();
bootIdentity({ signatures: data?.signatures, branding: data?.branding, followSystemMode: false });
