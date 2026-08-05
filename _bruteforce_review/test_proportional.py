import json
import numpy as np

with open("_all3_calibration.json") as f:
    data = json.load(f)

ratios_x = np.array([r["measured_cx"] / r["raw_cx"] for r in data if r["raw_cx"] > 1])
ratios_y = np.array([r["measured_cy"] / r["raw_cy"] for r in data if r["raw_cy"] > 1])

print(f"measured_cx / raw_cx: mean={ratios_x.mean():.3f} median={np.median(ratios_x):.3f} std={ratios_x.std():.3f}")
print(f"measured_cy / raw_cy: mean={ratios_y.mean():.3f} median={np.median(ratios_y):.3f} std={ratios_y.std():.3f}")

# fit measured = k*raw with NO intercept (least squares through origin)
raw_cx = np.array([r["raw_cx"] for r in data])
measured_cx = np.array([r["measured_cx"] for r in data])
k_x = (raw_cx * measured_cx).sum() / (raw_cx**2).sum()
pred_x = k_x * raw_cx
resid_x = measured_cx - pred_x
r2_x = 1 - (resid_x**2).sum() / ((measured_cx - measured_cx.mean())**2).sum()
print(f"\nNo-intercept fit X: measured_cx = {k_x:.4f} * raw_cx   R^2={r2_x:.4f}")

raw_cy = np.array([r["raw_cy"] for r in data])
measured_cy = np.array([r["measured_cy"] for r in data])
k_y = (raw_cy * measured_cy).sum() / (raw_cy**2).sum()
pred_y = k_y * raw_cy
resid_y = measured_cy - pred_y
r2_y = 1 - (resid_y**2).sum() / ((measured_cy - measured_cy.mean())**2).sum()
print(f"No-intercept fit Y: measured_cy = {k_y:.4f} * raw_cy   R^2={r2_y:.4f}")

print(f"\nImplied reference canvas: {5568/k_x:.1f} x {4176/k_y:.1f}")
