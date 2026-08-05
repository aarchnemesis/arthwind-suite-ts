import json
import math
import sys
import numpy as np
import requests
from io import BytesIO
from PIL import Image, ImageDraw

sys.path.insert(0, ".")
from fit_camera_model import (
    load_points_by_id, resolve_camera, to_camera_ray, PINHOLE_W, PINHOLE_H, MIN_RAY_Z
)

SRC_W, SRC_H = 3840, 1920


def clip_to_camera_front(rays):
    if len(rays) < 3:
        return [r for r in rays if r[2] > MIN_RAY_Z]
    clipped = []
    n = len(rays)
    for i in range(n):
        cur = rays[i]
        nxt = rays[(i + 1) % n]
        cur_in = cur[2] > MIN_RAY_Z
        nxt_in = nxt[2] > MIN_RAY_Z
        if cur_in:
            clipped.append(cur)
        if cur_in != nxt_in:
            t = (MIN_RAY_Z - cur[2]) / (nxt[2] - cur[2])
            clipped.append((cur[0] + (nxt[0] - cur[0]) * t, cur[1] + (nxt[1] - cur[1]) * t, MIN_RAY_Z))
    return clipped


def clip_to_frame(poly):
    if len(poly) < 3:
        return poly
    edges = [
        (lambda p: p[0] >= 0, 'x', 0),
        (lambda p: p[0] <= PINHOLE_W, 'x', PINHOLE_W),
        (lambda p: p[1] >= 0, 'y', 0),
        (lambda p: p[1] <= PINHOLE_H, 'y', PINHOLE_H),
    ]
    current = poly
    for inside_fn, axis, limit in edges:
        if not current:
            return current
        output = []
        n = len(current)
        idx = 0 if axis == 'x' else 1
        for i in range(n):
            a = current[i]
            b = current[(i + 1) % n]
            a_in = inside_fn(a)
            if a_in:
                output.append(a)
            if a_in != inside_fn(b):
                t = (limit - a[idx]) / (b[idx] - a[idx])
                output.append((a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t))
        current = output
    return current


def equirect_polygon_to_pinhole(points, src_w, src_h):
    yaw, pitch, focal_x, focal_y = resolve_camera(points, src_w, src_h)
    rays = [to_camera_ray(p, src_w, src_h, yaw, pitch) for p in points]
    clipped_rays = clip_to_camera_front(rays)
    projected = [
        ((rx / rz) * focal_x + PINHOLE_W / 2, PINHOLE_H / 2 - (ry / rz) * focal_y)
        for rx, ry, rz in clipped_rays
    ]
    return clip_to_frame(projected)


EXAMPLES = {
    "EOEVXQY1MU": "https://blob.arthnex.com/galleries/3a13a201-06b7-4011-8ee6-dc70e96a1647.JPG",
    "E9VJTJV728": "https://blob.arthnex.com/galleries/ae5781e4-fb0d-4856-866a-be8b63e2f5a3.JPG",
    "EU8COJB81S": "https://blob.arthnex.com/galleries/867a6a48-85bb-4b3f-92d1-5d4c4b32135a.JPG",
    "E4R2QUU8GD": "https://blob.arthnex.com/galleries/f3296bc0-4a42-41aa-b07c-5b372d9a322d.JPG",
    "EMZNSCZM07": "https://blob.arthnex.com/galleries/26a86384-d234-454b-a997-1fed5511761e.JPG",
    "66DB2D4EDB94A": "https://blob.arthnex.com/galleries/f5fe7507-6195-4c9d-ba24-08c40c6c1ffe.JPG",
}

points_by_id = load_points_by_id()

for defect_id, url in EXAMPLES.items():
    pts = points_by_id.get(defect_id)
    if not pts:
        print(f"{defect_id}: no points found")
        continue
    projected = equirect_polygon_to_pinhole(pts, SRC_W, SRC_H)
    projected = [(round(x), round(y)) for x, y in projected]
    print(f"{defect_id}: {projected}")

    resp = requests.get(url, timeout=30)
    img = Image.open(BytesIO(resp.content)).convert("RGB")
    draw = ImageDraw.Draw(img)
    thickness = max(8, round(img.width / 300))
    if len(projected) >= 3:
        closed = projected + [projected[0]]
        for i in range(len(closed) - 1):
            draw.line([closed[i], closed[i + 1]], fill=(255, 0, 0), width=thickness)
    img.save(f"verify_{defect_id}.jpg", quality=85)
