import fitz
import re
import json
import os

PDF_PATH = r"C:\Users\Pedro\Downloads\ATW-2024-0063-2-NAWP-LAGOA DOS VENTOS-VSR05-06.pdf"
OUT_DIR = os.path.join(os.path.dirname(__file__), "pdf_extracted")
os.makedirs(OUT_DIR, exist_ok=True)

doc = fitz.open(PDF_PATH)

# Defect ID pattern: alnum, all-caps/digits mix, 8-14 chars, appears right after "Description" label
DEFECT_ID_RE = re.compile(r'^[A-Z0-9]{8,16}$')

manifest = []
seen_ids = set()

for pno in range(doc.page_count):
    page = doc[pno]
    text = page.get_text()
    lines = [l.strip() for l in text.split('\n') if l.strip()]

    # Find defect IDs: lines that look like an ID and are preceded by "Description"
    defect_ids_on_page = []
    for i, line in enumerate(lines):
        if line == "Description" and i + 1 < len(lines):
            candidate = lines[i + 1]
            if DEFECT_ID_RE.match(candidate):
                defect_ids_on_page.append(candidate)

    if not defect_ids_on_page:
        continue

    # Get all images on page, keep only "photo-like" ones (large enough to be a real photo)
    images = page.get_images(full=True)
    photo_images = []
    for img in images:
        xref = img[0]
        w, h = img[2], img[3]
        if w >= 1500 and h >= 1000:
            photo_images.append((xref, w, h))

    if len(photo_images) != len(defect_ids_on_page):
        print(f"[WARN] page {pno+1}: {len(defect_ids_on_page)} defect IDs but {len(photo_images)} photo-like images — order-based pairing may be wrong")

    for idx, defect_id in enumerate(defect_ids_on_page):
        if defect_id in seen_ids:
            continue  # duplicate mention (e.g. summary table) — keep first occurrence only
        if idx >= len(photo_images):
            print(f"[SKIP] {defect_id} on page {pno+1}: no matching image")
            continue
        seen_ids.add(defect_id)
        xref, w, h = photo_images[idx]
        base = doc.extract_image(xref)
        ext = base["ext"]
        data = base["image"]
        fname = f"{defect_id}.{ext}"
        fpath = os.path.join(OUT_DIR, fname)
        with open(fpath, "wb") as f:
            f.write(data)
        manifest.append({"defectId": defect_id, "page": pno + 1, "file": fname, "width": w, "height": h})

print(f"\nExtracted {len(manifest)} defect images to {OUT_DIR}")
with open(os.path.join(OUT_DIR, "_pdf_manifest.json"), "w") as f:
    json.dump(manifest, f, indent=2)
