#!/usr/bin/env python3
"""Build the facade-detail index for the Discovery Lab ("Find similar details").

For every project listed in facade-set.json (or every project with an image when run with --all):
  1. download the catalogue render (the same `image` URL the page shows),
  2. run DINOv2 ViT-S/14 and keep its patch embeddings (one vector per 14x14 px patch),
  3. L2-normalise each patch vector and project it with a PCA fitted on all patches (384 -> DIMS),
  4. save the patch map, int8-quantised, as details/maps/<project id>.bin.

Each patch also gets its mean colour in CIELAB (the render resized to the patch grid).

Fragments: square windows of WINDOWS patches slide over every map; a fragment embedding is the
mean of the patch vectors it covers, L2-normalised, and its colour the mean of the patch colours.
All fragments go into details/fragments.bin (int8 embeddings), details/fragments-color.bin
(L, a, b) and details/fragments-meta.bin (project index + window in patch units).

In the browser, a user's rectangle on a catalogue image is described exactly the same way: the
patch vectors and colours of that image under the rectangle are averaged (weighted by overlap),
then compared with every fragment from the other projects:
    score = cosine(embedding) - LAMBDA * DeltaE(colour)
DINOv2 features see the kind of surface and its pattern (glazing, slats, brick courses); the colour
term separates materials with similar patterns (wood slats vs grey siding). So the query is the
selected region itself, not the whole frame, and no model runs in the browser.

Usage (from the repository root):
  python3 proposal/archicgi/discovery/tools/build_detail_index.py \
      --weights /path/to/dinov2_vits14_pretrain.pth [--cache /tmp/facade-cache]

Requirements: torch, timm, pillow, numpy, scikit-learn.
Weights: https://dl.fbaipublicfiles.com/dinov2/dinov2_vits14/dinov2_vits14_pretrain.pth
(Apache-2.0, sha256 below). They are not stored in the repository.
"""
import argparse, hashlib, io, json, os, struct, sys, urllib.parse, urllib.request
from datetime import date

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
LAB = os.path.dirname(HERE)
OUT = os.path.join(LAB, 'details')
WEIGHTS_URL = 'https://dl.fbaipublicfiles.com/dinov2/dinov2_vits14/dinov2_vits14_pretrain.pth'
WEIGHTS_SHA256 = 'b938bf1bc15cd2ec0feacfe3a1bb553fe8ea9ca46a7e1d8d00217f29aef60cd9'
PATCH = 14
TARGET_PATCHES = 48 * 27          # about 672 x 378 px for a 16:9 render
DIMS = 64                         # PCA dimensions kept
LAYERS = [11]                     # ViT blocks whose patch tokens are used (0-based). Tested [8, 11] and
                                  # [5, 8, 11]: they did not separate wood from glass better and blurred glass.
LAMBDA = 0.006                    # weight of the colour difference (per CIELAB Delta E unit)
LEVELS = {'close': 0.76, 'related': 0.66}   # score bands shown in the page; fewer than MIN_CLOSE
MIN_CLOSE = 3                               # results >= 'related' -> "few close details"
WINDOWS = [(4, 2), (7, 3)]        # (window size in patches, stride)
MEAN = np.array([0.485, 0.456, 0.406], dtype=np.float32)
STD = np.array([0.229, 0.224, 0.225], dtype=np.float32)


def sha256(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for chunk in iter(lambda: f.read(1 << 20), b''):
            h.update(chunk)
    return h.hexdigest()


def load_model(weights):
    import torch, timm
    if sha256(weights) != WEIGHTS_SHA256:
        sys.exit('unexpected weights checksum: ' + weights)
    model = timm.create_model('vit_small_patch14_dinov2', pretrained=False, img_size=518,
                              dynamic_img_size=True, num_classes=0)
    state = torch.load(weights, map_location='cpu')
    missing, unexpected = model.load_state_dict(state, strict=False)
    unexpected = [k for k in unexpected if k != 'mask_token']
    if missing or unexpected:
        sys.exit(f'weights do not match the model: missing={missing} unexpected={unexpected}')
    model.eval()
    return model


def fetch(url, cache):
    os.makedirs(cache, exist_ok=True)
    path = os.path.join(cache, hashlib.sha1(url.encode()).hexdigest() + os.path.splitext(url)[1])
    if not os.path.exists(path):
        url = urllib.parse.quote(url, safe="%/:?=&+@~#,;!$'()*[]")   # some catalogue URLs contain non-ASCII letters
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 (Discovery Lab index builder)'})
        with urllib.request.urlopen(req, timeout=60) as r, open(path, 'wb') as f:
            f.write(r.read())
    return path


def patch_grid(w, h):
    """Grid (gw, gh) with about TARGET_PATCHES patches and the image's aspect ratio."""
    s = (TARGET_PATCHES / (w * h)) ** 0.5
    return max(4, round(w * s)), max(4, round(h * s))


def embed(model, path, layers):
    import torch
    from PIL import Image
    im = Image.open(path).convert('RGB')
    gw, gh = patch_grid(*im.size)
    x = np.asarray(im.resize((gw * PATCH, gh * PATCH), Image.BICUBIC), dtype=np.float32) / 255.0
    x = (x - MEAN) / STD
    t = torch.from_numpy(x.transpose(2, 0, 1))[None]
    with torch.no_grad():
        # patch tokens of the chosen blocks, each normalised, then concatenated (equal weight per block)
        outs = model.forward_intermediates(t, indices=layers, norm=True, output_fmt='NLC', intermediates_only=True)
    feats = []
    for o in outs:
        f = o[0].numpy()
        assert f.shape[0] == gw * gh, f.shape
        feats.append(f / (np.linalg.norm(f, axis=1, keepdims=True) + 1e-8))
    patches = np.concatenate(feats, axis=1) / np.sqrt(len(feats))
    small = np.asarray(im.resize((gw, gh), Image.BOX), dtype=np.float32)   # mean colour of each patch
    return patches, srgb_to_lab(small).reshape(-1, 3), gw, gh, im.size


def srgb_to_lab(rgb):
    c = rgb / 255.0
    c = np.where(c > 0.04045, ((c + 0.055) / 1.055) ** 2.4, c / 12.92)
    m = np.array([[0.4124, 0.3576, 0.1805], [0.2126, 0.7152, 0.0722], [0.0193, 0.1192, 0.9505]])
    xyz = c @ m.T / np.array([0.95047, 1.0, 1.08883])
    f = np.where(xyz > 0.008856, np.cbrt(xyz), 7.787 * xyz + 16 / 116)
    return np.stack([116 * f[..., 1] - 16, 500 * (f[..., 0] - f[..., 1]), 200 * (f[..., 1] - f[..., 2])], -1)


def quant_lab(lab):
    """L in 0..100 -> uint8 (x2.55); a, b -> int8. Returns (n, 3) uint8 bytes and the dequantised values."""
    L = np.clip(np.round(lab[:, 0] * 2.55), 0, 255).astype(np.uint8)
    ab = np.clip(np.round(lab[:, 1:]), -127, 127).astype(np.int8)
    raw = np.concatenate([L[:, None], ab.view(np.uint8)], axis=1)
    deq = np.concatenate([L[:, None] / 2.55, ab.astype(np.float32)], axis=1)
    return raw, deq


def window_iter(gw, gh):
    for size, stride in WINDOWS:
        if size > gw or size > gh:
            continue
        xs = list(range(0, gw - size + 1, stride))
        ys = list(range(0, gh - size + 1, stride))
        if xs[-1] != gw - size: xs.append(gw - size)
        if ys[-1] != gh - size: ys.append(gh - size)
        for y in ys:
            for x in xs:
                yield x, y, size, size


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--weights', required=True, help='dinov2_vits14_pretrain.pth (' + WEIGHTS_URL + ')')
    ap.add_argument('--layers', default=','.join(map(str, LAYERS)), help='ViT blocks to use, e.g. 8,11')
    ap.add_argument('--all', action='store_true', help='index every project of graph-data.json that has an image (ignores facade-set.json)')
    ap.add_argument('--out', default=None, help='output directory (default: ../details)')
    ap.add_argument('--cache', default=os.path.join(os.environ.get('TMPDIR', '/tmp'), 'discovery-facade-cache'))
    args = ap.parse_args()

    from sklearn.decomposition import PCA
    data = json.load(open(os.path.join(LAB, 'graph-data.json'), encoding='utf-8'))
    by_id = {p['id']: p for p in data['projects']}
    if args.all:
        subset = [{'id': p['id']} for p in data['projects'] if p.get('image')]
    else:
        subset = json.load(open(os.path.join(HERE, 'facade-set.json'), encoding='utf-8'))['projects']
    missing = [s['id'] for s in subset if s['id'] not in by_id or not by_id[s['id']].get('image')]
    if missing:
        sys.exit('projects missing from graph-data.json or without image: ' + ', '.join(missing))

    out = args.out or OUT
    layers = [int(x) for x in args.layers.split(',')]
    model = load_model(args.weights)
    raw = []
    for k, s in enumerate(subset):
        p = by_id[s['id']]
        patches, lab, gw, gh, size = embed(model, fetch(p['image'], args.cache), layers)
        raw.append((p, patches, lab, gw, gh, size))
        print(f'[{k + 1}/{len(subset)}] {p["id"]} {gw}x{gh} patches  {p["label"][:60]}', flush=True)

    allp = np.concatenate([r[1] for r in raw])
    pca = PCA(n_components=DIMS, random_state=0).fit(allp)
    print(f'PCA {allp.shape[1]} -> {DIMS} dims, explained variance {pca.explained_variance_ratio_.sum():.3f}')

    os.makedirs(os.path.join(out, 'maps'), exist_ok=True)
    for f in os.listdir(os.path.join(out, 'maps')):
        os.remove(os.path.join(out, 'maps', f))
    projects, frag_emb, frag_meta, frag_col = [], [], [], []
    for idx, (p, patches, lab, gw, gh, size) in enumerate(raw):
        z = pca.transform(patches).astype(np.float32)                    # (gh*gw, DIMS)
        scale = float(np.abs(z).max()) / 127.0 or 1.0
        q = np.clip(np.round(z / scale), -127, 127).astype(np.int8)
        lab_raw, lab_q = quant_lab(lab)
        with open(os.path.join(out, 'maps', p['id'] + '.bin'), 'wb') as f:   # [gh*gw*DIMS int8][gh*gw*3 L,a,b]
            f.write(q.tobytes()); f.write(lab_raw.tobytes())
        zq = (q.astype(np.float32) * scale).reshape(gh, gw, DIMS)       # what the browser will see
        cq = lab_q.reshape(gh, gw, 3)
        for x, y, w, h in window_iter(gw, gh):
            v = zq[y:y + h, x:x + w].reshape(-1, DIMS).mean(0)
            v /= np.linalg.norm(v) + 1e-8
            frag_emb.append(np.clip(np.round(v * 127), -127, 127).astype(np.int8))
            frag_meta.append((idx, x, y, w, h))
            frag_col.append(cq[y:y + h, x:x + w].reshape(-1, 3).mean(0))
        projects.append({'id': p['id'], 'gw': gw, 'gh': gh, 'scale': round(scale, 8),
                         'image': p['image'], 'width': size[0], 'height': size[1]})

    emb = np.stack(frag_emb)
    emb.tofile(os.path.join(out, 'fragments.bin'))
    col_raw, col_q = quant_lab(np.array(frag_col))
    col_raw.tofile(os.path.join(out, 'fragments-color.bin'))
    with open(os.path.join(out, 'fragments-meta.bin'), 'wb') as f:
        for m in frag_meta:
            f.write(struct.pack('<5H', *m))

    # Calibration (information only): best score of a random fragment against other projects.
    e = emb.astype(np.float32) / 127.0
    e /= np.linalg.norm(e, axis=1, keepdims=True)
    owner = np.array([m[0] for m in frag_meta])
    rng = np.random.default_rng(0)
    best = []
    for i in rng.choice(len(e), size=min(1500, len(e)), replace=False):
        sims = e @ e[i] - LAMBDA * np.linalg.norm(col_q - col_q[i], axis=1)
        sims[owner == owner[i]] = -1
        best.append(sims.max())
    best = np.array(best)
    calib = {k: round(float(np.percentile(best, v)), 4) for k, v in (('p25', 25), ('p50', 50), ('p75', 75), ('p90', 90))}

    meta = {
        'version': 2,
        'built': date.today().isoformat(),
        'model': 'DINOv2 ViT-S/14 (facebookresearch/dinov2, Apache-2.0), patch embeddings',
        'layers': layers,
        'weightsSha256': WEIGHTS_SHA256,
        'patch': PATCH, 'dims': DIMS, 'windows': [{'size': s, 'stride': st} for s, st in WINDOWS],
        'pcaExplainedVariance': round(float(pca.explained_variance_ratio_.sum()), 4),
        'projects': projects,
        'fragments': int(len(frag_meta)),
        'files': {'embeddings': 'fragments.bin', 'color': 'fragments-color.bin', 'meta': 'fragments-meta.bin',
                  'maps': 'maps/<id>.bin (int8 gh*gw*dims, then L,a,b bytes per patch)'},
        'scoring': {'lambda': LAMBDA, 'levels': LEVELS, 'minClose': MIN_CLOSE,
                    'formula': 'cosine(embedding) - lambda * DeltaE76(Lab)'},
        'calibration': {'bestOtherProjectSimilarity': calib,
                        'note': 'Best score of a random fragment (sky and lawn included) against other projects.'},
    }
    with open(os.path.join(out, 'index.json'), 'w', encoding='utf-8') as f:
        json.dump(meta, f, ensure_ascii=False, indent=1)
        f.write('\n')
    print(f'{len(projects)} projects, {len(frag_meta)} fragments -> {out}')
    print('calibration', calib)


if __name__ == '__main__':
    main()
