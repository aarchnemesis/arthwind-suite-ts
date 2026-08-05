import json
import numpy as np

with open("_combined_calibration.json") as f:
    data = json.load(f)

# Exclude obvious detection failures (measured area implausibly tiny relative to raw)
clean = [r for r in data if r["scale_w"] and r["scale_w"] > 0.8]
excluded = [r for r in data if not (r["scale_w"] and r["scale_w"] > 0.8)]
print(f"Using {len(clean)} clean points, excluded {len(excluded)} likely detection failures:")
for r in excluded:
    print(f"   excluded: {r['defectId']} scale_w={r['scale_w']}")

raw_cx = np.array([r["raw_cx"] for r in clean])
raw_cy = np.array([r["raw_cy"] for r in clean])
measured_cx = np.array([r["measured_cx"] for r in clean])
measured_cy = np.array([r["measured_cy"] for r in clean])

# Fit measured = a*raw + b (linear regression, least squares)
Ax = np.vstack([raw_cx, np.ones_like(raw_cx)]).T
ax, bx = np.linalg.lstsq(Ax, measured_cx, rcond=None)[0]
pred_x = ax * raw_cx + bx
resid_x = measured_cx - pred_x
r2_x = 1 - (resid_x**2).sum() / ((measured_cx - measured_cx.mean())**2).sum()

Ay = np.vstack([raw_cy, np.ones_like(raw_cy)]).T
ay, by = np.linalg.lstsq(Ay, measured_cy, rcond=None)[0]
pred_y = ay * raw_cy + by
resid_y = measured_cy - pred_y
r2_y = 1 - (resid_y**2).sum() / ((measured_cy - measured_cy.mean())**2).sum()

print(f"\nX: measured_cx = {ax:.4f} * raw_cx + {bx:.1f}   (R^2={r2_x:.4f})")
print(f"Y: measured_cy = {ay:.4f} * raw_cy + {by:.1f}   (R^2={r2_y:.4f})")
print(f"\nresidual X: mean={resid_x.mean():.1f} std={resid_x.std():.1f} max_abs={np.abs(resid_x).max():.1f}")
print(f"residual Y: mean={resid_y.mean():.1f} std={resid_y.std():.1f} max_abs={np.abs(resid_y).max():.1f}")

# also fit scale_h (height) as a constant (median-based, robust)
scale_h = np.array([r["scale_h"] for r in clean if r["scale_h"]])
print(f"\nscale_h median (robust constant): {np.median(scale_h):.3f}")

print("\n=== worst residuals (points the linear fit explains poorly) ===")
combined_resid = np.abs(resid_x) + np.abs(resid_y)
order = np.argsort(-combined_resid)[:10]
for i in order:
    r = clean[i]
    print(f"  {r['defectId']:16s} raw_c=({raw_cx[i]:.0f},{raw_cy[i]:.0f}) measured_c=({measured_cx[i]:.0f},{measured_cy[i]:.0f}) "
          f"pred=({pred_x[i]:.0f},{pred_y[i]:.0f}) resid=({resid_x[i]:+.0f},{resid_y[i]:+.0f})")
