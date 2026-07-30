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

## Serving requirements (nginx / any host)

Two response headers decide whether this site works at all. Both were blocking
production on nova3d.xyz while the files themselves were being served fine.

1. **`blob:` must be allowed for scripts/workers.** The models are Draco-
   compressed and three's `DRACOLoader` builds its decoder workers from a
   `blob:` URL. Without it every compressed model silently fails to decode —
   the page renders, the stage stays empty, the status bar reads "… parts".
   (`setWorkerLimit(0)` is not a workaround: three then indexes an empty worker
   pool and nothing decodes either.)
2. **Same-origin framing must be allowed.** Three of the five Articulate /
   animate demos are their own pages embedded in an iframe. `X-Frame-Options:
   DENY` and `frame-src 'none'` each block them on their own.

```nginx
add_header X-Frame-Options "SAMEORIGIN" always;      # was DENY

add_header Content-Security-Policy "default-src 'self' https: data: blob:; \
img-src 'self' data: https: blob:; \
script-src 'self' 'unsafe-inline' 'unsafe-eval' blob: https:; \
worker-src 'self' blob:; \
style-src 'self' 'unsafe-inline' https:; \
font-src 'self' data: https:; \
connect-src 'self' https: wss:; \
frame-src 'self'; \
base-uri 'self'; form-action 'self';" always;
```

Verified against the live policy in a browser: with the current headers 0 of 3
models decode and the demo iframes are blocked; with the two changes above all
3 decode ("313 parts · 6 groups") and the demos render, with no CSP errors.

Note nginx does not merge `add_header`: a `location` block that sets any header
of its own drops these. The static `location /` currently sets none, so the
server-level headers apply.
