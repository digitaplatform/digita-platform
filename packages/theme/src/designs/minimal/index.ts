import minimal from '@digitaplatform/minimal/dist/index.js';
import type { Design } from '../types.js';

/**
 * MINIMAL — the baked default design. Its token values live in the
 * @digitaplatform/minimal package (digita-plugins-free) only, with the contrast
 * tuning they carry; theme.css paints them at :root, so a copy here could only
 * drift from the release a tenant gets as a plugin.
 */
const design: Design = minimal;

export default design;
