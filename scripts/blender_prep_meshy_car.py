#!/usr/bin/env python3
"""
Przygotowanie GLB auta (Meshy / Trellis) pod FlyBall.

- skala: długość nadwozia ≈ 1.18 m (oś +Z)
- origin: dół modelu na Y=0 (glTF Y-up)
- body → mesh „body”
- FLYBALL_EMPTY_WHEEL_WELLS=1 (domyślnie): usuwa osobne meshe kół, zostawia puste huby wheel_FL/FR/RL/RR
- NIE używaj FLYBALL_WHEEL_STRIP_RADIUS na body mesh — wycina dziury w karoserii Trellis

Użycie:
  blender --background --python scripts/blender_prep_meshy_car.py -- in.glb out.glb
  MESHY_CAR_SRC=... FLYBALL_ROOT=... bash scripts/meshy_prep_car.sh
"""

from __future__ import annotations

import math
import os
import sys

import bpy
from mathutils import Vector

TARGET_LENGTH_M = 1.18
WHEEL_NAMES = ("wheel_FL", "wheel_FR", "wheel_RL", "wheel_RR")
WHEEL_NAME_HINTS = ("wheel", "tire", "tyre", "rim", "opon", "tread")
DEFAULT_TIRE_RADIUS_M = 0.125


def _argv_paths() -> tuple[str, str]:
    if "--" in sys.argv:
        rest = sys.argv[sys.argv.index("--") + 1 :]
        if len(rest) >= 2:
            return rest[0], rest[1]
    root = os.environ.get("FLYBALL_ROOT", os.getcwd())
    src = os.environ.get(
        "MESHY_CAR_SRC", os.path.join(root, "public/assets/models/car_meshy_sized.glb")
    )
    out = os.path.join(root, "public/assets/models/car.glb")
    return src, out


def _empty_wells_enabled() -> bool:
    return os.environ.get("FLYBALL_EMPTY_WHEEL_WELLS", "1") != "0"


def _world_bbox(objects: list[bpy.types.Object]) -> tuple[Vector, Vector]:
    mins = Vector((1e9, 1e9, 1e9))
    maxs = Vector((-1e9, -1e9, -1e9))
    found = False
    for obj in objects:
        if obj.type != "MESH":
            continue
        for corner in obj.bound_box:
            w = obj.matrix_world @ Vector(corner)
            mins.x = min(mins.x, w.x)
            mins.y = min(mins.y, w.y)
            mins.z = min(mins.z, w.z)
            maxs.x = max(maxs.x, w.x)
            maxs.y = max(maxs.y, w.y)
            maxs.z = max(maxs.z, w.z)
            found = True
    if not found:
        return Vector((0, 0, 0)), Vector((0, 0, TARGET_LENGTH_M))
    return mins, maxs


def _mesh_volume_estimate(obj: bpy.types.Object) -> float:
    if obj.type != "MESH":
        return 0.0
    _min, _max = _world_bbox([obj])
    size = _max - _min
    return size.x * size.y * size.z


def _find_body_mesh(objects: list[bpy.types.Object]) -> bpy.types.Object | None:
    meshes = [o for o in objects if o.type == "MESH"]
    if not meshes:
        return None
    for obj in meshes:
        n = obj.name.lower()
        if n in ("body", "chassis", "car_body", "hull"):
            return obj
    return max(meshes, key=_mesh_volume_estimate)


def _is_wheel_mesh_name(name: str) -> bool:
    n = name.lower()
    if n == "body":
        return False
    return any(h in n for h in WHEEL_NAME_HINTS)


def _remove_wheel_objects(objects: list[bpy.types.Object]) -> None:
    to_remove: list[bpy.types.Object] = []
    for obj in objects:
        if obj.type != "MESH":
            continue
        if _is_wheel_mesh_name(obj.name):
            to_remove.append(obj)
    for obj in to_remove:
        bpy.data.objects.remove(obj, do_unlink=True)


def _mesh_objects() -> list[bpy.types.Object]:
    return [o for o in bpy.data.objects if o.type == "MESH"]


def _bake_world_rotation(euler_xyz: tuple[float, float, float]) -> None:
    """Obraca mesh w world-space i piecze rotację do wierzchołków (bez przesuwania origin)."""
    from mathutils import Euler

    rx, ry, rz = euler_xyz
    if abs(rx) + abs(ry) + abs(rz) < 1e-9:
        return
    rot = Euler((rx, ry, rz), "XYZ").to_matrix().to_4x4()
    bpy.context.view_layer.update()

    meshes = [o for o in bpy.data.objects if o.type == "MESH"]
    worlds = {o: o.matrix_world.copy() for o in meshes}
    parents = {o: o.parent for o in meshes}
    for o in meshes:
        o.parent = None
        o.matrix_world = rot @ worlds[o]
    bpy.context.view_layer.update()

    for o in meshes:
        bpy.ops.object.select_all(action="DESELECT")
        o.select_set(True)
        bpy.context.view_layer.objects.active = o
        bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)

    for o in meshes:
        p = parents.get(o)
        if p is None or p.name not in bpy.data.objects:
            continue
        mw = o.matrix_world.copy()
        o.parent = p
        o.matrix_world = mw
    bpy.context.view_layer.update()


def _bbox_size() -> Vector:
    meshes = _mesh_objects()
    if not meshes:
        return Vector((0.0, 0.0, 0.0))
    _min, _max = _world_bbox(meshes)
    return _max - _min


def _flyball_axes_ok(size: Vector) -> bool:
    """Y-up prep: X=szerokość, Y=wysokość (najmniejsza), Z=długość (największa)."""
    axes = [("x", size.x), ("y", size.y), ("z", size.z)]
    axes.sort(key=lambda t: t[1])
    return axes[0][0] == "y" and axes[2][0] == "z"


def _orient_length_to_plus_z(root: bpy.types.Object) -> None:
    """Trellis raw → układ muscle: X=szer., Y=wys., Z=dł. (Y-up w prep)."""
    del root
    bpy.context.view_layer.update()
    if not _mesh_objects():
        return

    for _ in range(8):
        size = _bbox_size()
        if _flyball_axes_ok(size):
            return
        axes = [("x", size.x), ("y", size.y), ("z", size.z)]
        axes.sort(key=lambda t: t[1])
        longest, shortest = axes[2][0], axes[0][0]
        if longest == "x":
            _bake_world_rotation((0.0, -math.pi / 2, 0.0))
            _bake_world_rotation((0.0, 0.0, -math.pi / 2))
        elif longest == "y":
            _bake_world_rotation((math.pi / 2, 0.0, 0.0))
            _bake_world_rotation((0.0, 0.0, -math.pi / 2))
        elif shortest == "x":
            _bake_world_rotation((0.0, 0.0, math.pi / 2))
        elif shortest == "z":
            _bake_world_rotation((math.pi / 2, 0.0, 0.0))
        else:
            _bake_world_rotation((0.0, 0.0, -math.pi / 2))
        bpy.context.view_layer.update()


def _flatten_hierarchy(root: bpy.types.Object) -> bpy.types.Object | None:
    """Trellis zostawia zagnieżdżone EMPTY (car/world) — spłaszcz body pod root."""
    bpy.context.view_layer.update()
    body = _find_body_mesh(list(bpy.data.objects))

    for obj in list(bpy.data.objects):
        if obj.type != "MESH":
            continue
        if obj is body:
            continue
        if _is_wheel_mesh_name(obj.name):
            bpy.data.objects.remove(obj, do_unlink=True)

    if body:
        world = body.matrix_world.copy()
        body.parent = root
        body.matrix_world = world
        body.name = "body"

    for obj in list(bpy.data.objects):
        if obj == root or obj is body:
            continue
        if obj.type == "EMPTY" and obj.name not in WHEEL_NAMES:
            bpy.data.objects.remove(obj, do_unlink=True)

    return body


def _strip_baked_wheels_from_body(
    body: bpy.types.Object,
    radius: float | None = None,
) -> int:
    """Usuwa wierzchołki kół wbake’owanych w mesh body (w pobliżu hubów)."""
    import bmesh

    bpy.context.view_layer.update()
    hubs: list[Vector] = []
    for name in WHEEL_NAMES:
        hub = bpy.data.objects.get(name)
        if hub:
            hubs.append(hub.matrix_world.translation.copy())
    if not hubs:
        return 0

    if radius is None:
        radius = float(os.environ.get("FLYBALL_WHEEL_STRIP_RADIUS", "0"))
    if radius <= 1e-6:
        return 0

    bm = bmesh.new()
    bm.from_mesh(body.data)
    bm.verts.ensure_lookup_table()
    remove: list[bmesh.types.BMVert] = []
    for v in bm.verts:
        wco = body.matrix_world @ v.co
        for hub in hubs:
            if (wco - hub).length <= radius:
                remove.append(v)
                break

    if not remove:
        bm.free()
        return 0

    bmesh.ops.delete(bm, geom=list(set(remove)), context="VERTS")
    bm.to_mesh(body.data)
    body.data.update()
    bm.free()
    return len(remove)


def _strip_spare_at_rear(body: bpy.types.Object, radius: float = 0.22) -> int:
    """Usuwa wbake’owany zapas z tyłu (buggy) — tylko gdy FLYBALL_STRIP_SPARE=1."""
    if os.environ.get("FLYBALL_STRIP_SPARE", "0") != "1":
        return 0
    import bmesh

    bpy.context.view_layer.update()
    _min, _max = _world_bbox([body])
    cx = (_min.x + _max.x) * 0.5
    cy = _min.y + (_max.y - _min.y) * 0.38
    cz = _min.z + (_max.z - _min.z) * 0.06
    spare = Vector((cx, cy, cz))

    bm = bmesh.new()
    bm.from_mesh(body.data)
    bm.verts.ensure_lookup_table()
    remove: list[bmesh.types.BMVert] = []
    for v in bm.verts:
        wco = body.matrix_world @ v.co
        if (wco - spare).length <= radius:
            remove.append(v)

    if not remove:
        bm.free()
        return 0

    bmesh.ops.delete(bm, geom=list(set(remove)), context="VERTS")
    bm.to_mesh(body.data)
    body.data.update()
    bm.free()
    return len(remove)


def _ensure_car_root() -> bpy.types.Object:
    meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    if not meshes:
        root = bpy.data.objects.new("car", None)
        bpy.context.collection.objects.link(root)
        return root

    # Jeden root — bez sztucznego „octaneCar”; runtime CarModel szuka body + wheel_*.
    root = bpy.data.objects.new("car", None)
    bpy.context.collection.objects.link(root)
    for obj in list(bpy.context.scene.objects):
        if obj is root:
            continue
        if obj.parent is None and obj.type in {"MESH", "EMPTY", "ARMATURE"}:
            obj.parent = root
    return root


def _tire_radius_m() -> float:
    return float(os.environ.get("FLYBALL_TIRE_RADIUS_M", str(DEFAULT_TIRE_RADIUS_M)))


def _cap_body_height(root: bpy.types.Object, body: bpy.types.Object | None) -> None:
    """Opcjonalnie spłaszcza nadmiarową wysokość (np. blade Trellis)."""
    cap = float(os.environ.get("FLYBALL_MAX_BODY_HEIGHT_M", "0"))
    if cap <= 1e-6:
        return
    measure = body if body else root
    bpy.context.view_layer.update()
    if measure.type == "MESH":
        mins, maxs = _world_bbox([measure])
    else:
        mins, maxs = _world_bbox([o for o in bpy.data.objects if o.type == "MESH"])
    height = maxs.y - mins.y
    if height <= cap + 1e-4:
        return
    root.scale.y *= cap / height
    bpy.context.view_layer.update()
    bpy.ops.object.select_all(action="DESELECT")
    root.select_set(True)
    bpy.context.view_layer.objects.active = root
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    _align_bottom_to_ground(root)


def _apply_uniform_scale_for_length(root: bpy.types.Object) -> None:
    bpy.context.view_layer.update()
    meshes = _mesh_objects()
    if not meshes:
        return
    _min, _max = _world_bbox(meshes)
    length = max(_max.z - _min.z, 1e-5)
    factor = TARGET_LENGTH_M / length
    root.scale = (factor, factor, factor)
    bpy.context.view_layer.update()
    bpy.ops.object.select_all(action="DESELECT")
    root.select_set(True)
    bpy.context.view_layer.objects.active = root
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)


def _align_bottom_to_ground(root: bpy.types.Object) -> None:
    bpy.context.view_layer.update()
    meshes = _mesh_objects()
    if not meshes:
        return
    mins, _max = _world_bbox(meshes)
    root.location.y -= mins.y
    bpy.context.view_layer.update()


def _track_half_width(body_width: float) -> float:
    tuck = 1.02
    return body_width * 0.5 - DEFAULT_TIRE_RADIUS_M * tuck


def _body_ground_y(body: bpy.types.Object) -> float:
    mins, _max = _world_bbox([body])
    return mins.y


def _normals_say_upside_down(body: bpy.types.Object) -> bool:
    """Dół bbox: nadwozie do góry nogami ma normalne skierowane w +Y zamiast -Y."""
    import bmesh

    if body.type != "MESH":
        return False

    bpy.context.view_layer.update()
    mins, maxs = _world_bbox([body])
    height = max(maxs.y - mins.y, 1e-6)
    band = mins.y + height * 0.18

    bm = bmesh.new()
    bm.from_mesh(body.data)
    up = down = 0
    for face in bm.faces:
        c = body.matrix_world @ face.calc_center_median()
        if c.y > band:
            continue
        face.normal_update()
        if face.normal.y > 0.25:
            up += 1
        elif face.normal.y < -0.25:
            down += 1
    bm.free()
    return up > down and up >= 12


def _ensure_mesh_upright(root: bpy.types.Object, body: bpy.types.Object | None) -> bool:
    """Obrót 180° wokół X gdy dół meshu to dach, nie podłoga."""
    measure = body if body else root
    if measure.type != "MESH" and not _mesh_objects():
        return False
    if measure.type != "MESH":
        measure = _find_body_mesh(_mesh_objects()) or measure
    if measure.type != "MESH":
        return False

    bpy.context.view_layer.update()
    mins, maxs = _world_bbox([measure])
    height = max(maxs.y - mins.y, 1e-6)
    high_band = maxs.y - height * 0.22
    low_band = mins.y + height * 0.22

    import bmesh

    bm = bmesh.new()
    bm.from_mesh(measure.data)
    top_horiz = bottom_horiz = 0.0
    for face in bm.faces:
        c = measure.matrix_world @ face.calc_center_median()
        face.normal_update()
        ny = face.normal.y
        if abs(ny) < 0.72:
            continue
        area = face.calc_area()
        if c.y >= high_band and ny > 0:
            top_horiz += area
        if c.y <= low_band and ny < 0:
            bottom_horiz += area
    bm.free()

    needs_flip = bottom_horiz > top_horiz * 1.2 and bottom_horiz > 0.02
    if not needs_flip:
        needs_flip = _normals_say_upside_down(measure)
    if not needs_flip:
        return False

    _bake_world_rotation((math.pi, 0.0, 0.0))
    bpy.context.view_layer.update()
    return True


def _place_wheel_hubs(root: bpy.types.Object, body: bpy.types.Object | None) -> None:
    measure = body if body else root
    bpy.context.view_layer.update()
    mins, maxs = _world_bbox([measure] if measure.type == "MESH" else [o for o in bpy.data.objects if o.type == "MESH"])
    cx = (mins.x + maxs.x) * 0.5
    cz = (mins.z + maxs.z) * 0.5
    length = maxs.z - mins.z
    width = maxs.x - mins.x
    ground_y = _body_ground_y(measure) if measure.type == "MESH" else mins.y
    z_front = cz + length * 0.3
    z_rear = cz - length * 0.28
    wx = _track_half_width(width)
    hub_y = ground_y + _tire_radius_m()

    positions = {
        "wheel_FL": (-wx, hub_y, z_front),
        "wheel_FR": (wx, hub_y, z_front),
        "wheel_RL": (-wx, hub_y, z_rear),
        "wheel_RR": (wx, hub_y, z_rear),
    }

    for name in WHEEL_NAMES:
        old = bpy.data.objects.get(name)
        if old:
            bpy.data.objects.remove(old, do_unlink=True)

    for name, loc in positions.items():
        empty = bpy.data.objects.new(name, None)
        bpy.context.collection.objects.link(empty)
        empty.empty_display_size = 0.06
        empty.location = loc
        empty.parent = root


def _prune_small_islands(body: bpy.types.Object, min_ratio: float = 0.08) -> int:
    """Usuwa tylko małe luźne wyspy (baked koła). NIE usuwa dużych — zostawia karoserię."""
    import bmesh

    if body.type != "MESH":
        return 0

    bm = bmesh.new()
    bm.from_mesh(body.data)
    bm.faces.ensure_lookup_table()

    visited: set[int] = set()
    islands: list[list[bmesh.types.BMFace]] = []
    for face in bm.faces:
        if face.index in visited:
            continue
        stack = [face]
        comp: list[bmesh.types.BMFace] = []
        while stack:
            f = stack.pop()
            if f.index in visited:
                continue
            visited.add(f.index)
            comp.append(f)
            for edge in f.edges:
                for linked in edge.link_faces:
                    if linked.index not in visited:
                        stack.append(linked)
        islands.append(comp)

    if len(islands) <= 1:
        bm.free()
        return 0

    def island_vert_count(comp: list[bmesh.types.BMFace]) -> int:
        verts: set[int] = set()
        for f in comp:
            for v in f.verts:
                verts.add(v.index)
        return len(verts)

    sizes = [island_vert_count(comp) for comp in islands]
    max_size = max(sizes)
    cutoff = max(64, int(max_size * min_ratio))
    removed = 0
    for comp, size in zip(islands, sizes):
        if size >= cutoff:
            continue
        bmesh.ops.delete(bm, geom=comp, context="FACES")
        removed += len(comp)

    bm.to_mesh(body.data)
    body.data.update()
    bm.free()
    return removed


def _cull_interior_shell_faces(body: bpy.types.Object) -> int:
    """Usuwa wewnętrzną skorupę — face „sandwiched” między dwoma warstwami (BVH)."""
    import bmesh
    from mathutils.bvhtree import BVHTree

    if body.type != "MESH":
        return 0

    bpy.context.view_layer.update()
    mins, maxs = _world_bbox([body])
    diag = (maxs - mins).length
    max_dist = max(0.004, diag * float(os.environ.get("FLYBALL_INTERIOR_SHELL_FRAC", "0.028")))

    bm = bmesh.new()
    bm.from_mesh(body.data)
    bm.faces.ensure_lookup_table()
    if len(bm.faces) < 32:
        bm.free()
        return 0

    tree = BVHTree.FromBMesh(bm)
    remove: list[bmesh.types.BMFace] = []
    eps = 0.0015

    for face in bm.faces:
        face.normal_update()
        c = face.calc_center_median()
        n = face.normal.copy()
        if n.length_squared < 1e-12:
            continue
        n.normalize()
        hit_p = tree.ray_cast(c + n * eps, n)
        hit_n = tree.ray_cast(c - n * eps, -n)
        if hit_p[0] is None or hit_n[0] is None:
            continue
        dist_p = hit_p[3] if hit_p[3] is not None else 1e9
        dist_n = hit_n[3] if hit_n[3] is not None else 1e9
        if dist_p < max_dist and dist_n < max_dist:
            remove.append(face)

    if not remove:
        bm.free()
        return 0

    bmesh.ops.delete(bm, geom=remove, context="FACES")
    bm.to_mesh(body.data)
    body.data.update()
    removed = len(remove)
    bm.free()
    return removed


def _trellis_shell_cleanup_enabled() -> bool:
    return _gentle_weld_enabled() or os.environ.get("FLYBALL_DROP_INVERTED", "0") == "1"


def _post_weld_heal(body: bpy.types.Object) -> None:
    """Lekkie zespawanie po czyszczeniu skorupy — scala krawędzie bez fill_holes."""
    if body.type != "MESH":
        return
    threshold = float(os.environ.get("FLYBALL_POST_WELD_MERGE", "0.0025"))
    bpy.context.view_layer.objects.active = body
    body.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.mesh.remove_doubles(threshold=max(threshold, 1e-6))
    bpy.ops.mesh.normals_make_consistent(inside=False)
    bpy.ops.object.mode_set(mode="OBJECT")
    body.data.update()


def _cull_inward_faces(body: bpy.types.Object) -> int:
    """Usuwa odwrócone ściany wewnętrznej skorupy (Trellis duplicate shell)."""
    import bmesh
    from mathutils import Vector

    if body.type != "MESH":
        return 0

    bpy.context.view_layer.update()
    mins, maxs = _world_bbox([body])
    center = Vector(((mins.x + maxs.x) * 0.5, (mins.y + maxs.y) * 0.5, (mins.z + maxs.z) * 0.5))

    bm = bmesh.new()
    bm.from_mesh(body.data)
    bm.faces.ensure_lookup_table()
    inv_world = body.matrix_world.inverted()
    center_local = inv_world @ center

    remove: list[bmesh.types.BMFace] = []
    for face in bm.faces:
        face.normal_update()
        c = face.calc_center_median()
        outward = c - center_local
        if outward.length_squared < 1e-10:
            continue
        outward.normalize()
        if face.normal.dot(outward) < 0.02:
            remove.append(face)

    if not remove:
        bm.free()
        return 0

    bmesh.ops.delete(bm, geom=remove, context="FACES")
    bm.to_mesh(body.data)
    body.data.update()
    removed = len(remove)
    bm.free()
    return removed


def _drop_inverted_islands(body: bpy.types.Object, threshold: float | None = None) -> int:
    """Usuwa odwrócone skorupy (Trellis duplikat do góry nogami w tym samym meshu)."""
    import bmesh

    if threshold is None:
        threshold = float(os.environ.get("FLYBALL_INVERT_THRESHOLD", "-0.04"))

    if body.type != "MESH":
        return 0

    bm = bmesh.new()
    bm.from_mesh(body.data)
    bm.faces.ensure_lookup_table()

    visited: set[int] = set()
    islands: list[list[bmesh.types.BMFace]] = []
    for face in bm.faces:
        if face.index in visited:
            continue
        stack = [face]
        comp: list[bmesh.types.BMFace] = []
        while stack:
            f = stack.pop()
            if f.index in visited:
                continue
            visited.add(f.index)
            comp.append(f)
            for edge in f.edges:
                for linked in edge.link_faces:
                    if linked.index not in visited:
                        stack.append(linked)
        islands.append(comp)

    removed = 0
    for comp in islands:
        if len(comp) < 48:
            continue
        area = 0.0
        weighted_ny = 0.0
        for f in comp:
            f.normal_update()
            a = f.calc_area()
            area += a
            weighted_ny += f.normal.y * a
        if area < 1e-8:
            continue
        if (weighted_ny / area) < threshold:
            bmesh.ops.delete(bm, geom=comp, context="FACES")
            removed += len(comp)

    bm.to_mesh(body.data)
    body.data.update()
    bm.free()
    return removed


def _gentle_weld_enabled() -> bool:
    return os.environ.get("FLYBALL_GENTLE_WELD", "0") == "1"


def _gentle_weld_trellis_mesh(body: bpy.types.Object) -> tuple[int, int]:
    """Jedno zespawanie (≈3 mm) — scala fragmenty Trellis bez agresywnego merge 0.015."""
    import bmesh

    if body.type != "MESH":
        return 0, 0

    threshold = float(os.environ.get("FLYBALL_GENTLE_WELD_MERGE", "0.003"))

    bm = bmesh.new()
    bm.from_mesh(body.data)
    islands_before = _count_face_islands(bm)
    bm.free()

    bpy.context.view_layer.objects.active = body
    body.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.mesh.remove_doubles(threshold=max(threshold, 1e-6))
    bpy.ops.mesh.normals_make_consistent(inside=False)
    bpy.ops.object.mode_set(mode="OBJECT")
    body.data.update()

    bm = bmesh.new()
    bm.from_mesh(body.data)
    islands_after = _count_face_islands(bm)
    bm.free()
    return islands_before, islands_after


def _count_face_islands(bm: "bmesh.types.BMesh") -> int:
    bm.faces.ensure_lookup_table()
    visited: set[int] = set()
    islands = 0
    for face in bm.faces:
        if face.index in visited:
            continue
        islands += 1
        stack = [face]
        while stack:
            f = stack.pop()
            if f.index in visited:
                continue
            visited.add(f.index)
            for edge in f.edges:
                for linked in edge.link_faces:
                    if linked.index not in visited:
                        stack.append(linked)
    return islands


def _repair_mesh_enabled() -> bool:
    return os.environ.get("FLYBALL_REPAIR_MESH", "0") == "1"


def _repair_fragmented_trellis_mesh(
    body: bpy.types.Object,
    merge_threshold: float | None = None,
    fill_sides: int | None = None,
) -> tuple[int, int]:
    """Zespawa luźne wyspy Trellis i zamyka małe dziury (szczeliny paneli, grille).

    Trellis często eksportuje ~10k+ mikro-wysp z otwartymi krawędziami — merge + fill_holes
    scala je w jedną skorupę. Duże otwory (łuki kół) zostają — fill_holes ma limit sides.
    Dwa przebiegi (fine + coarse) domykają szczeliny między panelami bez voxel remesh.
    """
    import bmesh

    if body.type != "MESH":
        return 0, 0

    default_merge = float(os.environ.get("FLYBALL_REPAIR_MERGE", "0.005"))
    default_sides = int(os.environ.get("FLYBALL_REPAIR_FILL_SIDES", "128"))
    coarse_merge = float(os.environ.get("FLYBALL_REPAIR_COARSE_MERGE", "0.015"))
    coarse_sides = int(os.environ.get("FLYBALL_REPAIR_COARSE_FILL_SIDES", "256"))

    bm = bmesh.new()
    bm.from_mesh(body.data)
    boundary_before = sum(1 for e in bm.edges if e.is_boundary)
    bm.free()

    bpy.context.view_layer.objects.active = body
    body.select_set(True)

    passes: list[tuple[float, int]] = []
    if merge_threshold is not None:
        passes.append((merge_threshold, fill_sides or default_sides))
    else:
        passes.append((default_merge, default_sides))
        if coarse_merge > default_merge + 1e-6:
            passes.append((coarse_merge, coarse_sides))

    for merge, sides in passes:
        bpy.ops.object.mode_set(mode="EDIT")
        bpy.ops.mesh.select_all(action="SELECT")
        bpy.ops.mesh.remove_doubles(threshold=max(merge, 1e-6))
        bpy.ops.mesh.fill_holes(sides=max(sides, 3))
        bpy.ops.object.mode_set(mode="OBJECT")

    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.mesh.normals_make_consistent(inside=False)
    bpy.ops.object.mode_set(mode="OBJECT")
    body.data.update()

    bm = bmesh.new()
    bm.from_mesh(body.data)
    boundary_after = sum(1 for e in bm.edges if e.is_boundary)
    bm.free()
    return boundary_before, boundary_after


def _island_prune_enabled() -> bool:
    return os.environ.get("FLYBALL_PRUNE_ISLANDS", "0") == "1"


def _darken_milky_glass_enabled() -> bool:
    return os.environ.get("FLYBALL_DARKEN_MILKY_GLASS", "0") == "1"


def _darken_milky_cabin_albedo(body: bpy.types.Object) -> int:
    """Przyciemnia mleczno-białe plamy albedo w strefie kabiny (szyby Trellis)."""
    import bmesh

    if body.type != "MESH" or not body.data.materials:
        return 0

    body.update_tag()
    bpy.context.view_layer.update()
    mins, maxs = _world_bbox([body])
    height = max(maxs.y - mins.y, 1e-6)
    length = max(maxs.z - mins.z, 1e-6)
    y0 = mins.y + height * 0.42
    y1 = mins.y + height * 0.98
    z0 = mins.z + length * 0.22
    z1 = mins.z + length * 0.82

    # Zbierz UV z face'ów kabiny
    bm = bmesh.new()
    bm.from_mesh(body.data)
    bm.faces.ensure_lookup_table()
    uv_layer = bm.loops.layers.uv.active
    if uv_layer is None:
        bm.free()
        return 0

    cabin_uvs: list[tuple[float, float]] = []
    for face in bm.faces:
        c = body.matrix_world @ face.calc_center_median()
        if not (y0 <= c.y <= y1 and z0 <= c.z <= z1):
            continue
        for loop in face.loops:
            uv = loop[uv_layer].uv
            cabin_uvs.append((uv.x, uv.y))
    bm.free()
    if not cabin_uvs:
        return 0

    touched = 0
    target = (0.06, 0.07, 0.09, 1.0)  # charcoal glass
    for slot in body.data.materials:
        if not slot:
            continue
        mat = slot
        if not mat.use_nodes or not mat.node_tree:
            continue
        for node in mat.node_tree.nodes:
            if node.type != "TEX_IMAGE" or node.image is None:
                continue
            img = node.image
            if img.size[0] < 8 or img.size[1] < 8:
                continue
            w, h = int(img.size[0]), int(img.size[1])
            pixels = list(img.pixels)
            changed = False
            # Rasteryzuj punkty UV kabiny z małym sąsiedztwem
            seen: set[int] = set()
            for u, v in cabin_uvs:
                uu = u % 1.0
                vv = v % 1.0
                cx = int(uu * (w - 1))
                cy = int(vv * (h - 1))
                for dx in (-1, 0, 1, 2):
                    for dy in (-1, 0, 1, 2):
                        x = min(w - 1, max(0, cx + dx))
                        y = min(h - 1, max(0, cy + dy))
                        idx = (y * w + x) * 4
                        if idx in seen:
                            continue
                        seen.add(idx)
                        r, g, b = pixels[idx], pixels[idx + 1], pixels[idx + 2]
                        # mleczny / kredowy / jasnoszary — niska saturacja, wysoka jasność
                        mx, mn = max(r, g, b), min(r, g, b)
                        avg = (r + g + b) / 3.0
                        if mx < 0.48:
                            continue
                        if (mx - mn) > 0.18:
                            continue  # kolorowa farba / neon
                        if avg < 0.52:
                            continue
                        pixels[idx] = target[0]
                        pixels[idx + 1] = target[1]
                        pixels[idx + 2] = target[2]
                        touched += 1
                        changed = True
            if changed:
                img.pixels = pixels
                img.update()
    return touched


def main() -> None:
    input_path, output_path = _argv_paths()
    empty_wells = _empty_wells_enabled()

    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=input_path)

    root = _ensure_car_root()
    body = _flatten_hierarchy(root)
    if not body:
        body = _find_body_mesh(list(bpy.data.objects))
        if body:
            body.name = "body"

    repair_before = 0
    repair_after = 0
    weld_before = 0
    weld_after = 0
    inverted_faces = 0
    interior_faces = 0
    flipped_upright = False
    if body and _trellis_shell_cleanup_enabled():
        inverted_faces = _drop_inverted_islands(body)
    if body and _gentle_weld_enabled():
        weld_before, weld_after = _gentle_weld_trellis_mesh(body)
        for _ in range(4):
            removed = _cull_interior_shell_faces(body)
            interior_faces += removed
            if removed == 0:
                break
        inverted_faces += _drop_inverted_islands(body)
        _post_weld_heal(body)
    elif body and _repair_mesh_enabled():
        repair_before, repair_after = _repair_fragmented_trellis_mesh(body)

    _orient_length_to_plus_z(root)
    _apply_uniform_scale_for_length(root)
    if body:
        force = os.environ.get("FLYBALL_FORCE_UPRIGHT_FLIP", "0") == "1"
        if force:
            _bake_world_rotation((math.pi, 0.0, 0.0))
            bpy.context.view_layer.update()
            flipped_upright = True
            print("FORCE upright flip 180° X", file=sys.stderr)
        else:
            flipped_upright = _ensure_mesh_upright(root, body)
    elif _mesh_objects():
        flipped_upright = _ensure_mesh_upright(root, _find_body_mesh(_mesh_objects()))
    _align_bottom_to_ground(root)
    _cap_body_height(root, body)

    if empty_wells:
        _remove_wheel_objects(list(bpy.data.objects))

    pruned_faces = 0
    if empty_wells and body and _island_prune_enabled():
        pruned_faces = _prune_small_islands(body)

    milky = 0
    if body and _darken_milky_glass_enabled():
        milky = _darken_milky_cabin_albedo(body)

    _place_wheel_hubs(root, body)

    # Vertex strip WYŁĄCZONY — na jednym meshu Trellis tworzy dziury w karoserii.
    # Koła: runtime (cosmetic GLB) + opcjonalna regeneracja Trellis z promptem NO wheels.
    stripped = 0
    strip_radius = float(os.environ.get("FLYBALL_WHEEL_STRIP_RADIUS", "0"))
    if empty_wells and body and strip_radius > 1e-6:
        print(
            f"WARN: FLYBALL_WHEEL_STRIP_RADIUS={strip_radius} — może uszkodzić karoserię",
            file=sys.stderr,
        )
        stripped = _strip_baked_wheels_from_body(body, strip_radius)
        if os.environ.get("FLYBALL_STRIP_SPARE", "0") == "1":
            stripped += _strip_spare_at_rear(body)

    os.makedirs(os.path.dirname(output_path) or ".", exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=output_path,
        export_format="GLB",
        use_selection=False,
        export_apply=True,
    )
    mode = "empty wheel wells" if empty_wells else "stock wheels kept"
    print(
        f"blender_prep_meshy_car: {output_path} ({mode}, L≈{TARGET_LENGTH_M}m, "
        f"weld_islands={weld_before}->{weld_after}, inverted_faces={inverted_faces}, "
        f"interior_faces={interior_faces}, flipped_upright={int(flipped_upright)}, "
        f"repair_boundary={repair_before}->{repair_after}, "
        f"pruned_faces={pruned_faces}, stripped_verts={stripped}, milky_px={milky})"
    )


if __name__ == "__main__":
    main()
