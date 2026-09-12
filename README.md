# Jacob Palko — Mechanical Engineering Portfolio

A single-page portfolio styled as a living engineering drawing: dark graphite,
safety orange, mono annotations, and a procedurally-generated high-bypass
turbofan in Three.js — real NACA airfoil blades with root-to-tip twist,
counter-rotating spools — that you can drag, and that disassembles into the
classic fan → compressor → combustor → turbine → nozzle exploded view as you
scroll.

## Run it

It's a static site — no build step, no dependencies to install.

```bash
cd jaypee
python3 -m http.server 8000
# open http://localhost:8000
```

Any static file server works. (Opening `index.html` directly with `file://`
won't load the ES-module scripts — use a server.)

Deploy by pushing the folder to GitHub Pages, Netlify, or Vercel as-is.

## Structure

```
index.html                  all content lives here — start editing in this file
css/styles.css              design system (colors, type, layout)
js/scene.js                 Three.js turbofan + exploded view
js/animations.js            GSAP scroll choreography
js/main.js                  preloader, cursor, nav, drag input, HUD
assets/resume-placeholder.pdf
assets/projects/project-01..04.pdf
scripts/make_placeholders.py  regenerates the placeholder PDFs
```

## Make it yours

Everything editable is flagged with `<!-- EDIT: -->` comments in `index.html`:

1. **Analytics** — replace `G-XXXXXXX` in `<head>` or delete that block.
2. **Contact** — real email, LinkedIn, GitHub URLs in the contact section.
3. **Bio / stats / coursework** — the About section numbers are placeholders;
   replace with your real GPA, project count, internships.
4. **Experience** — org names, dates, and bullets in the Experience Log.
5. **Projects** — for each card: href, title, blurb, tags, and title-block
   metadata. Drop real PDFs into `assets/projects/` and update the hrefs.
6. **Résumé** — replace `assets/resume-placeholder.pdf` (keep the filename
   and nothing else needs to change).

To regenerate the placeholder sheets after deleting them:

```bash
python3 scripts/make_placeholders.py
```

## Notes

- The turbofan is built for real: blades are NACA symmetric airfoil profiles
  (4-digit thickness distribution) extruded radially with linear twist and
  chord taper; the HP spool counter-rotates against the fan/LP spool.
- The engine *runs*: ~620 airflow streak particles ride CFD-style streamlines
  (cold intake → compression warm-up → combustor fire → hot plume, with a cold
  bypass sheath), the combustor flickers and throws real point-light fire glow
  onto the surrounding stages, and the exhaust plume carries shock diamonds.
- `prefers-reduced-motion` is respected throughout; the site also survives
  CDN or WebGL failures (content shows, stage hides).
