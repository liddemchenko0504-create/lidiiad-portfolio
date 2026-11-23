# Discovery Lab — facade detail index

`build_detail_index.py` builds the index behind **Rechercher des détails similaires / Find similar details**.
The page needs only the files it writes to `../details/`; no model runs in the browser.

## What it does

1. Reads the projects to index. With `--all` (the current build) that is every project with an image. Without it,
   the curated subset in `facade-set.json`: 73 renders whose facade is large in frame at eye level, each checked by
   eye. Interiors, aerial views and gardens are included in the full build, so a match can be an interior detail
   (a wall, a ceiling) as well as a facade.
2. Downloads each catalogue render (the same `image` URL as in `graph-data.json`, 768 px wide) and runs
   **DINOv2 ViT-S/14** on it. It keeps one embedding per 14×14 px patch (about 48×27 patches per render),
   L2-normalised and reduced with PCA (384 → 64 dimensions). It also keeps each patch's mean colour in CIELAB.
3. Writes the patch map of each render to `details/maps/<id>.bin`. The browser loads only the map of
   the render being viewed.
4. Slides square windows (4 patches with stride 2, and 7 patches with stride 3) over every map. Each
   window becomes a fragment: the mean of its patch vectors (normalised) and its mean colour. The result
   is `details/fragments.bin`, `fragments-color.bin` and `fragments-meta.bin`, loaded once on the first search.

In the page, a rectangle drawn on a render is described the same way, from that render's own patch map,
with patches weighted by how much of them the rectangle covers. It is then compared with the fragments
of every other project:

```
score = cosine(embedding) − 0.006 × ΔE(colour)
```

DINOv2 sees the kind of surface and its pattern (glazing, slats, brick courses). The colour term separates
materials with similar patterns, such as wood slats and grey siding. The score bands shown in the page
are set in `index.json` → `scoring`:

| Band | Score |
|---|---|
| Very close | ≥ 0.76 |
| Close | 0.66 – 0.76 |
| Distant | below 0.66 |

When fewer than 3 results reach "close", the page says that few close details exist.

Current build: **all 434 projects, 181,369 fragments** (`--all`), about 51 MB in total. Of that, about 37 MB is
per-render maps (around 85 KB each, loaded on demand) and 14 MB is fragments (loaded once, on the first search).
The score bands are `close` ≥ 0.76 and `related` ≥ 0.66 (raised from 0.72 / 0.62 when the pool grew from 73 to 434
projects, which lifts the best-match baseline by about 0.03).

## Rebuild or extend

```bash
pip install torch timm pillow numpy scikit-learn
curl -LO https://dl.fbaipublicfiles.com/dinov2/dinov2_vits14/dinov2_vits14_pretrain.pth
python3 proposal/archicgi/discovery/tools/build_detail_index.py --all --weights dinov2_vits14_pretrain.pth
```

* **Curated subset.** Drop `--all` to index only `facade-set.json`. To change that subset, add `{"id": "acgi-…", "title": "…"}` entries to `facade-set.json`, then rerun.
  The ids come from `graph-data.json`. Check the renders by eye first: the index is only as good as the
  facades it contains.
* **Weights.** DINOv2 ViT-S/14, Apache-2.0. The script checks the sha256 before loading. The weights are
  not stored in the repository.
* **Other options.** `--layers 8,11` tries other ViT blocks. On the wood and glass test these did not
  separate the materials better. `--out DIR` writes elsewhere, for experiments.
* **Rebuild everything.** The index must be rebuilt as a whole: the PCA is fitted on all patches, so
  adding one project changes every vector.

# Homepage search suggestions

`build_suggestions.js` picks the clickable examples under the search box («Essayer :» / «Try:») from the portfolio data,
and writes them to `../suggestions.json`. The page reads that file; no example text is hard-coded elsewhere.

1. `suggestion-candidates.json` lists candidate requests, each in French and English.
2. The script opens the page in headless Chromium and runs every candidate through the page's own search engine
   (`window.discoveryBrief.search`, the same code as the search box).
3. A candidate is kept only if it is fully understood (no unknown or stray words), returns **the same projects in French
   and English**, has at least **20** projects meeting every criterion but no more than a quarter of the catalogue,
   has at least **85 %** of those projects backed by editorial tags (not only by a word in a title), ranks full matches
   first, and names something to look at (building type, inside/outside, view, space or animation).
4. Selection: the best request for each of the three most frequent building types in `graph-data.json`, then the
   remaining slots by number of matching projects, each criterion family once (building types up to four times), and no
   two suggestions sharing more than 35 % of their projects.

```bash
node proposal/archicgi/discovery/tools/build_suggestions.js           # rebuild suggestions.json
node proposal/archicgi/discovery/tools/build_suggestions.js --check   # re-run the saved ones; non-zero exit on drift
```

Needs Node and Playwright (Chromium). `--cytoscape <file>` serves Cytoscape from a local file when unpkg is unreachable;
`--report <file>` writes every candidate's measures. Run `--check` after changing `graph-data.json` or the search engine.
