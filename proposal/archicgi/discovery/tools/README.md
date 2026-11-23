# Discovery Lab — facade detail index

`build_detail_index.py` builds the index behind **Rechercher des détails similaires / Find similar details**.
The page needs only the files it writes to `../details/`; no model runs in the browser.

## What it does

1. Reads the curated subset in `facade-set.json`: projects whose render shows a facade large in frame,
   at eye level. Each one was checked by eye on a contact sheet. Aerial views, gardens, pools,
   interiors and tiny buildings were left out.
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
| Very close | ≥ 0.72 |
| Close | 0.62 – 0.72 |
| Distant | below 0.62 |

When fewer than 3 results reach "close", the page says that few close details exist.

Current build: **73 projects, 30,526 fragments**, about 8.5 MB in total. Of that, 6.2 MB is per-render
maps (around 85 KB each, loaded on demand) and 2.3 MB is fragments (loaded once).

## Rebuild or extend

```bash
pip install torch timm pillow numpy scikit-learn
curl -LO https://dl.fbaipublicfiles.com/dinov2/dinov2_vits14/dinov2_vits14_pretrain.pth
python3 proposal/archicgi/discovery/tools/build_detail_index.py --weights dinov2_vits14_pretrain.pth
```

* **Extend the subset.** Add `{"id": "acgi-…", "title": "…"}` entries to `facade-set.json`, then rerun.
  The ids come from `graph-data.json`. Check the renders by eye first: the index is only as good as the
  facades it contains.
* **Weights.** DINOv2 ViT-S/14, Apache-2.0. The script checks the sha256 before loading. The weights are
  not stored in the repository.
* **Other options.** `--layers 8,11` tries other ViT blocks. On the wood and glass test these did not
  separate the materials better. `--out DIR` writes elsewhere, for experiments.
* **Rebuild everything.** The index must be rebuilt as a whole: the PCA is fitted on all patches, so
  adding one project changes every vector.
