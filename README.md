# Banana Poster

One-page banana **poster / collage** builder: full-bleed bruise **texture** background, place risograph **bananas** (per-instance **Bruise** and size), and drag brand **stickers** on top.

## Run locally

From the repo root (the static site root):

```bash
python3 -m http.server 4173
```

Open [http://localhost:4173](http://localhost:4173).

Or with Node:

```bash
npx --yes serve . -l 4173
```

## Stack

Static HTML / CSS / JS. No backend.

- Typeface: **Apfel Grotezk** (`fonts/ApfelGrotezk-Mittel.otf`)
- Poster texture: `textures/banana-poster-texture.jpg` (exported 4800×3303 from Anna’s 20400×14040 master, ~4.7 MB JPEG q88)
- Ripeness frames: `frames/banana-00.png` … `banana-30.png` (per placed banana via inline Bruise)
- Stickers: `stickers/*.png`

## Controls

- **Banana** — add banana instances to the poster (click or drag from tool)
- **Bruise − / +** — appears inline when a banana is selected; steps that instance’s ripeness frame
- **Stickers** — click to drop on the banana, or drag from the library; drag placed stickers to move them
