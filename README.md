# nova3d.xyz — redesign

Self-contained static site. Open `Nova3D Site.dc.html` in any browser
(or serve the folder). Renders standalone — no Claude Design / claude.ai
account required.

## Preview locally
    cd ~/nova3d-site && python3 -m http.server 8130
    # open http://localhost:8130/Nova3D%20Site.dc.html

## Contents
- `Nova3D Site.dc.html` — the page (DC component)
- `support.js`          — the render runtime (self-contained)
- `nova-viewer.js`      — the three.js 3D viewer web component
- `assets/`             — studio GLBs, live UV GLBs, showcase webps, world-teaser video

## Deploy
It's static files. Drop the folder on any static host (Netlify, Vercel,
Azure Static Web Apps, an S3/blob bucket, nginx). No build step.

This folder — not any claude.ai project — is the source of truth.
