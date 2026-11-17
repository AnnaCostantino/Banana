# Banana Editor

One-page banana customizer: step through 31 risograph ripeness frames with **Bruise**, then drag brand stickers onto the banana.

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
- Ripeness frames: `frames/banana-00.png` … `banana-30.png` (ripe → rotten)
- Stickers: `stickers/*.png`

## Controls

- **Bruise − / +** — previous / next ripeness frame
- **Stickers** — click to drop on the banana, or drag from the library; drag placed stickers to move them
