# nova3d.xyz — redesign

Self-contained static site. Open `index.html` in any browser (or serve the
folder). Renders standalone — no Claude Design / claude.ai account required.

## Preview locally
    cd ~/nova3d-site && python3 -m http.server 8130
    # open http://localhost:8130/index.html

## Contents
- `index.html`          — **the page. This is the one that ships.**
- `Nova3D Site.dc.html` — older DC-component snapshot, no longer updated;
                          it predates the merged Articulate / animate tab
- `support.js`          — the render runtime (self-contained)
- `nova-viewer.js`      — the three.js 3D viewer web component, incl. rig mode
- `assets/`             — studio GLBs, live UV/edit/rig GLBs, showcase webps,
                          world-teaser video

## Deploy
It's static files. Drop the folder on any static host (Netlify, Vercel,
Azure Static Web Apps, an S3/blob bucket, nginx). No build step.

This folder — not any claude.ai project — is the source of truth.
