#!/usr/bin/env python3
"""
Wycina koło z wbake’owanego mesh body (Trellis) w pobliżu huba — eksport GLB felgi.

  blender --background --python scripts/blender_extract_wheel_from_body.py -- in.glb out.glb FL

Oś obrotu +X, środek w origin, średnica ≈ 0.35 m (jak blender_gen_wheel.py).
"""

from __future__ import annotations

import math
import os
import sys

import bpy
import bmesh
from mathutils import Vector

WHEEL_NAMES = ("wheel_FL", "wheel_FR", "wheel_RL", "wheel_RR")
DEFAULT_RADIUS = 0.17


def _argv() -> tuple[str, str, str]:
    if "--" in sys.argv:
        rest = sys.argv[sys.argv.index("--") + 1 :]
        if len(rest) >= 3:
            return rest[0], rest[1], rest[2]
    root = os.environ.get("FLYBALL_ROOT", os.getcwd())
    car = os.environ.get("FLYBALL_CAR_GLB", os.path.join(root, "public/assets/cars/buggy.glb"))
    out = os.environ.get(
        "FLYBALL_WHEEL_OUT", os.path.join(root, "public/assets/items/wheels/dune.glb")
    )
    hub = os.environ.get("FLYBALL_WHEEL_HUB", "wheel_FL")
    return car, out, hub


def _find_body() -> bpy.types.Object | None:
    for obj in bpy.data.objects:
        if obj.type == "MESH" and obj.name.lower() in ("body", "chassis", "geometry_0"):
            return obj
    meshes = [o for o in bpy.data.objects if o.type == "MESH"]
    return max(meshes, key=lambda o: len(o.data.vertices), default=None) if meshes else None


def _hub_world(hub_name: str) -> Vector | None:
    hub = bpy.data.objects.get(hub_name)
    if not hub:
        return None
    return hub.matrix_world.translation.copy()


def _extract_wheel_patch(
    body: bpy.types.Object,
    hub_world: Vector,
    radius: float,
) -> bpy.types.Object | None:
    import bmesh

    bm = bmesh.new()
    bm.from_mesh(body.data)
    bm.verts.ensure_lookup_table()
    keep_verts: list[bmesh.types.BMVert] = []
    for v in bm.verts:
        wco = body.matrix_world @ v.co
        if (wco - hub_world).length <= radius:
            keep_verts.append(v)

    if len(keep_verts) < 24:
        bm.free()
        return None

    keep_set = set(keep_verts)
    remove = [v for v in bm.verts if v not in keep_set]
    bmesh.ops.delete(bm, geom=remove, context="VERTS")

    mesh = bpy.data.meshes.new("wheel_extract")
    bm.to_mesh(mesh)
    bm.free()

    obj = bpy.data.objects.new("wheel", mesh)
    bpy.context.collection.objects.link(obj)
    obj.matrix_world = body.matrix_world
    return obj


def _center_and_orient_wheel(obj: bpy.types.Object) -> None:
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    bpy.ops.object.origin_set(type="ORIGIN_GEOMETRY", center="BOUNDS")
    bpy.context.view_layer.update()

    dims = obj.dimensions
    if not (dims.x <= dims.y and dims.x <= dims.z):
        if dims.y <= dims.x and dims.y <= dims.z:
            obj.rotation_euler = (0.0, 0.0, math.pi / 2.0)
        else:
            obj.rotation_euler = (math.pi / 2.0, 0.0, 0.0)
        bpy.ops.object.transform_apply(rotation=True)
        bpy.ops.object.origin_set(type="ORIGIN_GEOMETRY", center="BOUNDS")

    target_d = float(os.environ.get("FLYBALL_WHEEL_TARGET_D", "0.35"))
    max_dim = max(obj.dimensions.x, obj.dimensions.y, obj.dimensions.z)
    if max_dim > 1e-4:
        s = target_d / max_dim
        obj.scale = (s, s, s)
        bpy.ops.object.transform_apply(scale=True)
        bpy.ops.object.origin_set(type="ORIGIN_GEOMETRY", center="BOUNDS")


def main() -> None:
    car_path, out_path, hub_name = _argv()
    radius = float(os.environ.get("FLYBALL_WHEEL_STRIP_RADIUS", "0.18"))

    raw_alt = car_path.replace(".glb", "_raw.glb")
    src = raw_alt if os.path.isfile(raw_alt) else car_path
    hub_src = os.environ.get("FLYBALL_WHEEL_HUB_GLB", "")
    if not hub_src:
        stem = os.path.basename(car_path).replace("_trellis_raw.glb", "").replace(".glb", "")
        guess = os.path.join(os.path.dirname(car_path), f"{stem}.glb")
        if os.path.isfile(guess) and guess != src:
            hub_src = guess

    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=src)

    body = _find_body()
    if not body:
        raise SystemExit("brak mesh body")

    hub_world = _hub_world(hub_name)
    if not hub_world and hub_src and os.path.isfile(hub_src):
        bpy.ops.import_scene.gltf(filepath=hub_src)
        hub_world = _hub_world(hub_name)
    if not hub_world:
        # przybliżony hub z bbox
        _min, _max = Vector((1e9, 1e9, 1e9)), Vector((-1e9, -1e9, -1e9))
        for corner in body.bound_box:
            w = body.matrix_world @ Vector(corner)
            _min.x = min(_min.x, w.x)
            _min.y = min(_min.y, w.y)
            _min.z = min(_min.z, w.z)
            _max.x = max(_max.x, w.x)
            _max.y = max(_max.y, w.y)
            _max.z = max(_max.z, w.z)
        cx = (_min.x + _max.x) * 0.5
        cz = (_min.z + _max.z) * 0.5
        hub_world = Vector((cx - (_max.x - _min.x) * 0.38, _min.y + 0.12, cz + (_max.z - _min.z) * 0.28))

    wheel = _extract_wheel_patch(body, hub_world, radius)
    if not wheel:
        raise SystemExit(f"za mało geometrii kół przy {hub_name} (radius={radius})")

    for obj in list(bpy.data.objects):
        if obj != wheel:
            bpy.data.objects.remove(obj, do_unlink=True)

    _center_and_orient_wheel(wheel)
    os.makedirs(os.path.dirname(out_path) or ".", exist_ok=True)
    bpy.ops.object.select_all(action="DESELECT")
    wheel.select_set(True)
    bpy.context.view_layer.objects.active = wheel
    bpy.ops.export_scene.gltf(
        filepath=out_path,
        export_format="GLB",
        use_selection=True,
        export_apply=True,
    )
    print(f"blender_extract_wheel: {out_path} hub={hub_name} radius={radius}")


if __name__ == "__main__":
    main()
