/**
 * Lumen brand icons for the Obsidian plugin.
 *
 * Registers custom SVGs via Obsidian's addIcon() API so they can be
 * used anywhere a Lucide icon name is accepted (ribbon, view tabs,
 * status bar, setIcon() calls).
 *
 * SVG content targets a 100×100 viewBox (Obsidian's convention).
 * The flame motif is derived from lumen-icon.svg, transformed from
 * its native viewBox (60 5 150 205) into 100×100 centered coords.
 */

import { addIcon } from 'obsidian';

/**
 * Flame path data from lumen-icon.svg.
 * Original coordinate space: nested transforms applied below.
 */
const FLAME_PATH = 'M 21.633,34.925 C 24.973,46.855 40.837,53.71 46.922,66.223 C 49.866,72.279 48.49,83.461 43.464,87.939 C 43.197,88.178 42.09,90.326 43.217,89.521 C 54.416,81.327 63.521,70.509 59.309,60.068 C 53.464,45.577 38.409,38.34 38.519,23.585 C 38.566,17.447 43.088,12.523 48.838,7.375 L 49.073,6.299 C 34.143,10.56 17.742,21.028 21.633,34.925 Z M 59.314,18.723 C 67.987,26.524 73.282,31.263 71.043,40.298 C 73.766,36.119 76.295,30.323 74.135,25.806 C 72.203,21.769 70.28,18.956 63.244,15.02 C 59.515,12.935 56.712,10.677 54.37,6.898 C 54.248,10.853 55.011,14.852 59.314,18.723 Z M 49.686,32.153 C 53.003,38.255 57.845,42.622 62.538,48.882 C 65.869,53.325 68.92,60.704 65.731,66.728 L 65.937,67.016 C 70.824,61.556 71.028,52.654 69.495,46.059 C 67.086,35.69 58.5,31.5 53.511,23.918 C 51.557,20.948 50.446,17.311 51,13.5 C 45.461,18.021 46.717,26.69 49.686,32.153 Z';

/**
 * Build the flame SVG group.
 * Maps from lumen-icon.svg's viewBox(60,5,150,205) → Obsidian's 100×100:
 *   scale = min(100/150, 100/205) ≈ 0.4878
 *   center horizontally: dx = (100 - 150×0.4878) / 2 ≈ 13.4
 */
function flameGroup(): string {
	return `<g transform="translate(13.4,0) scale(0.4878) translate(-60,-5)">
  <g transform="translate(10,10)">
    <g transform="matrix(1.8554,0,0,1.8554,35.938,8.312)" fill="currentColor">
      <g transform="scale(1,-1)">
        <g transform="translate(0,-96)">
          <path d="${FLAME_PATH}"/>
        </g>
      </g>
    </g>
  </g>
</g>`;
}

/** Full brand mark: flame icon (monochrome, for Obsidian's icon system) */
export const LUMEN_LOGO_SVG = flameGroup();

/**
 * Full-color brand icon: yellow rounded-rect background + black flame.
 * Multi-color so can't use addIcon()/setIcon(). Render via ref + innerHTML.
 */
export const LUMEN_BRAND_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <rect x="5" y="5" width="90" height="90" rx="18" fill="#fccd41"/>
  <g transform="translate(13.4,0) scale(0.4878) translate(-60,-5)">
    <g transform="translate(10,10)">
      <g transform="matrix(1.8554,0,0,1.8554,35.938,8.312)" fill="#000">
        <g transform="scale(1,-1)">
          <g transform="translate(0,-96)">
            <path d="${FLAME_PATH}"/>
          </g>
        </g>
      </g>
    </g>
  </g>
</svg>`;

/** Brand mark with search accent (magnifying glass at bottom-right) */
export const LUMEN_SEARCH_SVG = `${flameGroup()}
<circle cx="76" cy="76" r="12" stroke="currentColor" stroke-width="3" fill="none" opacity="0.7"/>
<line x1="84" y1="84" x2="94" y2="94" stroke="currentColor" stroke-width="3" stroke-linecap="round" opacity="0.7"/>`;

/** Register all Lumen brand icons with Obsidian. Call once in onload(). */
export function registerLumenIcons(): void {
	addIcon('lumen-logo', LUMEN_LOGO_SVG);
	addIcon('lumen-search', LUMEN_SEARCH_SVG);
}
