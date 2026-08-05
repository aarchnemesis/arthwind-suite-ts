import json
import numpy as np

with open("_cross_reference.json") as f:
    a = json.load(f)
with open("VSR07-04/_cross_reference.json") as f:
    b = json.load(f)
with open("VSR22-02/_cross_reference.json") as f:
    c = json.load(f)

combined = a + b + c
valid = [r for r in combined if "note" not in r and r.get("raw_w", 0) > 5 and r.get("raw_h", 0) > 5]
clean = [r for r in valid if r["scale_w"] and r["scale_w"] > 0.8]
excluded = [r for r in valid if not (r["scale_w"] and r["scale_w"] > 0.8)]

print(f"Total valid: {len(valid)} | clean (excluding likely detection failures): {len(clean)}")
for r in excluded:
    print(f"  excluded: {r['defectId']} scale_w={r['scale_w']}")

with open("_all3_calibration.json", "w") as f:
    json.dump(clean, f, indent=2)

scale_w = np.array([r["scale_w"] for r in clean])
scale_h = np.array([r["scale_h"] for r in clean])
print(f"\nscale_w: mean={scale_w.mean():.3f} median={np.median(scale_w):.3f} std={scale_w.std():.3f}")
print(f"scale_h: mean={scale_h.mean():.3f} median={np.median(scale_h):.3f} std={scale_h.std():.3f}")
print(f"\nSaved {len(clean)} points to _all3_calibration.json")
