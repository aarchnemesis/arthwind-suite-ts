import json
import numpy as np

with open("_cross_reference.json") as f:
    a = json.load(f)
with open("VSR07-04/_cross_reference.json") as f:
    b = json.load(f)

combined = a + b
valid = [r for r in combined if "note" not in r and r.get("raw_w", 0) > 5 and r.get("raw_h", 0) > 5]
print(f"Combined valid entries: {len(valid)} (VSR05-06: {len([r for r in a if 'note' not in r])}, VSR07-04: {len([r for r in b if 'note' not in r])})")

with open("_combined_calibration.json", "w") as f:
    json.dump(valid, f, indent=2)

scale_w = np.array([r["scale_w"] for r in valid if r["scale_w"]])
scale_h = np.array([r["scale_h"] for r in valid if r["scale_h"]])
print(f"\nscale_w: mean={scale_w.mean():.3f} median={np.median(scale_w):.3f} std={scale_w.std():.3f}")
print(f"scale_h: mean={scale_h.mean():.3f} median={np.median(scale_h):.3f} std={scale_h.std():.3f}")

# Bucket by raw_w to see the "clipping" pattern more clearly
print("\n=== scale_h vs raw_w (looking for clipping pattern) ===")
for r in sorted(valid, key=lambda x: x["raw_w"]):
    print(f"  {r['defectId']:16s} raw_w={r['raw_w']:>6.0f} raw_h={r['raw_h']:>5.0f}  "
          f"scale_w={r['scale_w']!s:>7} scale_h={r['scale_h']!s:>7}  measured_w={r['measured_w']:>6.0f}")
