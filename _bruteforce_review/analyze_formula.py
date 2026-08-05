import json
import numpy as np

with open("_cross_reference.json") as f:
    data = json.load(f)

valid = [r for r in data if "note" not in r and r.get("raw_w", 0) > 5 and r.get("raw_h", 0) > 5]
print(f"Valid measured entries: {len(valid)}")

scale_w = np.array([r["scale_w"] for r in valid if r["scale_w"]])
scale_h = np.array([r["scale_h"] for r in valid if r["scale_h"]])

print(f"\nscale_w: mean={scale_w.mean():.3f} median={np.median(scale_w):.3f} std={scale_w.std():.3f}")
print(f"scale_h: mean={scale_h.mean():.3f} median={np.median(scale_h):.3f} std={scale_h.std():.3f}")

# Try to fit the OLD case-2 style formula: measured_c = raw_c + (raw_c - raw_center)*scaleFactor...
# Actually old formula scales around the RAW polygon's own center then shifts by fixed (xShift,yShift).
# So: measured_center = raw_center*1 + xShift  (since expansion around own center doesn't move the center)
# i.e. offset_x should be ~constant (xShift) regardless of raw position, IF old formula's assumption holds.
offsets_x = np.array([r["offset_x"] for r in valid])
offsets_y = np.array([r["offset_y"] for r in valid])
print(f"\noffset_x: mean={offsets_x.mean():.1f} median={np.median(offsets_x):.1f} std={offsets_x.std():.1f}")
print(f"offset_y: mean={offsets_y.mean():.1f} median={np.median(offsets_y):.1f} std={offsets_y.std():.1f}")

print("\n=== per-entry detail (sorted by scale_h) ===")
for r in sorted(valid, key=lambda x: x.get("scale_h") or 0):
    print(f"  {r['defectId']:16s} sev={r['severity']} comp={str(r['component']):12s} "
          f"raw=({r['raw_w']:.0f}x{r['raw_h']:.0f}) measured=({r['measured_w']:.0f}x{r['measured_h']:.0f}) "
          f"scale=({r['scale_w']},{r['scale_h']}) offset=({r['offset_x']:+.0f},{r['offset_y']:+.0f})")
