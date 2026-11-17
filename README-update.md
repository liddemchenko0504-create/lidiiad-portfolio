# Dirty Talk Lipstick PDP shade switcher update

This `index.html` is the user-supplied portfolio HTML with the IL MAKIAGE lipstick selector wired to four supplied screenshots and the user-supplied HEX values. The rest of the page was left as provided, including its other project placeholders and references to images not included here.

## Included files
- `index.html`
- `assets/dirty-talk-averie-pdp.webp`
- `assets/dirty-talk-diaz-pdp.webp`
- `assets/dirty-talk-ariadna-pdp.webp`
- `assets/dirty-talk-william-pdp.webp`

## Shade codes
- AVERIE: `#961D28` (normalized from `##961D28`)
- DIAZ: `#741A20` (normalized from `741A20`)
- ARIADNA: `#C04F4A`
- WILLIAM: `#382A34`

## Upload to GitHub Pages
1. Edit the current repository `index.html` and replace its contents with this one (if you wish to deploy this particular user-supplied version).
2. Create `assets/` in the repository root and upload all four WebP files to it.
3. Commit. Your existing GitHub Pages deployment will republish.
4. Keep Custom domain empty until DNS routing is fixed.

The photos/screenshots in `assets/` are captured from the IL MAKIAGE publicly shown product page and are for a credited portfolio case, not original brand assets created by the portfolio author. Confirm your right to republish before deploying publicly.

Potential issue: the original HTML loads Motion from `https://cdn.jsdelivr.net/npm/motion@14.9.0/dist/motion.js` and Three.js from CDN. This update does not assert the CDN Motion global works without testing in browser.
