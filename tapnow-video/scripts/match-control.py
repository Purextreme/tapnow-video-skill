"""Locate a learned control in a local CUA screenshot. Never clicks or connects to a browser."""
import argparse
import json
import time
from pathlib import Path

import cv2
import numpy as np


def read_image(path):
    result = cv2.imdecode(np.fromfile(Path(path), dtype=np.uint8), cv2.IMREAD_COLOR)
    if result is None:
        raise ValueError(f'Cannot decode image: {path}')
    return result


DEFAULT_SCALES = (.7, .75, .8, .85, .9, .95, 1, 1.05, 1.1, 1.2, 1.25, 1.5, 2)


def locate(image, template, *, roi=None, scales=DEFAULT_SCALES, threshold=.88, margin=.08):
    started = time.perf_counter()
    ih, iw = image.shape[:2]
    if roi is None:
        roi = (0, 0, iw, ih)
    x, y, w, h = map(int, roi)
    if x < 0 or y < 0 or min(w, h) <= 0 or x+w > iw or y+h > ih:
        raise ValueError('ROI must be inside the current screenshot')
    if not 0 < threshold <= 1 or not 0 < margin <= 1:
        raise ValueError('Invalid confidence thresholds')
    if template.size == 0 or np.std(template) < 3:
        raise ValueError('Template has insufficient features')
    # Normalized grayscale correlation tolerates antialiasing and brightness changes.
    # Binarized edges lose too much information for a 20px glyph at fractional scale.
    frame = cv2.cvtColor(image[y:y+h, x:x+w], cv2.COLOR_BGR2GRAY)
    candidates = []
    for scale in scales:
        if not np.isfinite(scale) or not .2 <= scale <= 5:
            raise ValueError('Invalid template scale')
        tw, th = round(template.shape[1]*scale), round(template.shape[0]*scale)
        if min(tw, th) < 8 or tw > w or th > h:
            continue
        resized = cv2.resize(template, (tw, th), interpolation=cv2.INTER_AREA if scale < 1 else cv2.INTER_CUBIC)
        features = cv2.cvtColor(resized, cv2.COLOR_BGR2GRAY)
        if np.std(features) < 3:
            continue
        scores = cv2.matchTemplate(frame, features, cv2.TM_CCOEFF_NORMED)
        for _ in range(8):
            _, score, _, point = cv2.minMaxLoc(scores)
            if score < max(.35, threshold-margin-.2):
                break
            px, py = point
            candidates.append({'x':x+px, 'y':y+py, 'width':tw, 'height':th, 'score':float(score), 'scale':scale})
            scores[max(0,py-th//2):py+th//2+1, max(0,px-tw//2):px+tw//2+1] = -1
    candidates.sort(key=lambda c: -c['score'])
    peaks = []
    for c in candidates:
        cx, cy = c['x']+c['width']/2, c['y']+c['height']/2
        if all(np.hypot(cx-(p['x']+p['width']/2), cy-(p['y']+p['height']/2)) > max(c['width'],c['height'],p['width'],p['height'])*.7 for p in peaks):
            peaks.append(c)
    best = peaks[0] if peaks else None
    second = peaks[1]['score'] if len(peaks)>1 else 0
    accepted = bool(best and best['score'] >= threshold and best['score']-second >= margin)
    return {'accepted':accepted, 'reason':'unique-match' if accepted else 'ambiguous' if best and best['score']>=threshold else 'low-confidence',
            'match':best, 'secondScore':second, 'margin':None if not best else best['score']-second,
            'imageSize':{'width':iw,'height':ih}, 'roi':[x,y,w,h],
            'coordinateFrame':'current-screenshot-pixels', 'elapsedMs':(time.perf_counter()-started)*1000}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--image', required=True)
    parser.add_argument('--template', required=True)
    parser.add_argument('--roi', type=int, nargs=4, metavar=('X','Y','W','H'))
    parser.add_argument('--scales', type=float, nargs='+', default=list(DEFAULT_SCALES))
    parser.add_argument('--threshold', type=float, default=.88)
    parser.add_argument('--margin', type=float, default=.08)
    args = parser.parse_args()
    result = locate(read_image(args.image), read_image(args.template), roi=args.roi, scales=args.scales, threshold=args.threshold, margin=args.margin)
    print(json.dumps(result, ensure_ascii=False))
    return 0 if result['accepted'] else 2


if __name__ == '__main__':
    raise SystemExit(main())
