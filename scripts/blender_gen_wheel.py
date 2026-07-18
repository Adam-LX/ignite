#!/usr/bin/env python3
"""
Proceduralne koła FlyBall — tarcza w płaszczyźnie YZ, oś obrotu +X (jak runtime wheelMount).

  blender --background --python scripts/blender_gen_wheel.py -- factory out.glb
  bash scripts/build_procedural_wheels.sh
"""

from __future__ import annotations

import math
import os
import sys

import bpy
from mathutils import Vector

WHEEL_DIAMETER_M = 0.35
TIRE_WIDTH_M = 0.13
RIM_RADIUS_M = WHEEL_DIAMETER_M * 0.38
TIRE_RADIUS_M = WHEEL_DIAMETER_M * 0.5

STYLES = ("factory", "steel", "rally", "neon", "chrome", "default")


def _argv() -> tuple[str, str]:
    if "--" in sys.argv:
        rest = sys.argv[sys.argv.index("--") + 1 :]
        if len(rest) >= 2:
            return rest[0], rest[1]
    root = os.environ.get("FLYBALL_ROOT", os.getcwd())
    style = os.environ.get("FLYBALL_WHEEL_STYLE", "factory")
    out = os.path.join(root, f"public/assets/items/wheels/{style}.glb")
    return style, out


def _clear() -> None:
    bpy.ops.wm.read_factory_settings(use_empty=True)


def _mat(name: str, **kwargs) -> bpy.types.Material:
    mat = bpy.data.materials.new(name=name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    if not bsdf:
        return mat
    key_map = {
        "Base_Color": "Base Color",
        "Roughness": "Roughness",
        "Metallic": "Metallic",
        "Emission": "Emission Color",
        "Emission_Strength": "Emission Strength",
    }
    for key, val in kwargs.items():
        socket = key_map.get(key, key)
        if socket in bsdf.inputs:
            bsdf.inputs[socket].default_value = val
    return mat


def _style_materials(style: str) -> tuple[bpy.types.Material, bpy.types.Material]:
    s = "factory" if style == "default" else style
    tire = _mat(
        f"{s}_tire",
        Base_Color=(0.06, 0.06, 0.07, 1.0),
        Roughness=0.92,
        Metallic=0.02,
    )
    if s == "rally":
        rim = _mat(
            f"{s}_rim",
            Base_Color=(0.92, 0.92, 0.9, 1.0),
            Roughness=0.55,
            Metallic=0.35,
        )
    elif s == "neon":
        rim = _mat(
            f"{s}_rim",
            Base_Color=(0.05, 0.85, 0.95, 1.0),
            Emission=(0.1, 0.95, 1.0, 1.0),
            Emission_Strength=4.5,
            Roughness=0.2,
            Metallic=0.7,
        )
    elif s == "chrome":
        rim = _mat(
            f"{s}_rim",
            Base_Color=(0.95, 0.96, 0.98, 1.0),
            Roughness=0.06,
            Metallic=1.0,
        )
    elif s == "steel":
        rim = _mat(
            f"{s}_rim",
            Base_Color=(0.55, 0.58, 0.62, 1.0),
            Roughness=0.38,
            Metallic=0.82,
        )
    else:
        rim = _mat(
            f"{s}_rim",
            Base_Color=(0.42, 0.44, 0.48, 1.0),
            Roughness=0.45,
            Metallic=0.72,
        )
    return tire, rim


def _assign_mat(obj: bpy.types.Object, mat: bpy.types.Material) -> None:
    if obj.type != "MESH":
        return
    if obj.data.materials:
        obj.data.materials[0] = mat
    else:
        obj.data.materials.append(mat)


def _cylinder_x(
    name: str,
    radius: float,
    depth: float,
    segments: int = 32,
) -> bpy.types.Object:
    bpy.ops.mesh.primitive_cylinder_add(
        radius=radius,
        depth=depth,
        vertices=segments,
        location=(0.0, 0.0, 0.0),
    )
    obj = bpy.context.active_object
    obj.name = name
    obj.rotation_euler = (0.0, math.pi / 2.0, 0.0)
    return obj


def _add_spokes(
    root: bpy.types.Object,
    mat: bpy.types.Material,
    count: int,
    length: float,
    width: float,
    thickness: float,
) -> None:
    for i in range(count):
        bpy.ops.mesh.primitive_cube_add(size=1.0, location=(0.0, 0.0, 0.0))
        spoke = bpy.context.active_object
        spoke.name = f"spoke_{i}"
        spoke.dimensions = (thickness, width, length)
        spoke.rotation_euler = (0.0, 0.0, (2.0 * math.pi * i) / count)
        spoke.location = (
            0.0,
            math.sin(spoke.rotation_euler.z) * length * 0.42,
            math.cos(spoke.rotation_euler.z) * length * 0.42,
        )
        _assign_mat(spoke, mat)
        spoke.parent = root


def _build_wheel(style: str) -> bpy.types.Object:
    tire_mat, rim_mat = _style_materials(style)
    s = "factory" if style == "default" else style

    root = bpy.data.objects.new("wheel", None)
    bpy.context.collection.objects.link(root)

    tire_scale = 1.12 if s == "rally" else 1.0
    tire = _cylinder_x(
        "tire",
        TIRE_RADIUS_M * tire_scale,
        TIRE_WIDTH_M * (1.15 if s == "rally" else 1.0),
        segments=36,
    )
    _assign_mat(tire, tire_mat)
    tire.parent = root

    hub = _cylinder_x("hub", RIM_RADIUS_M * 0.42, TIRE_WIDTH_M * 0.55, segments=24)
    _assign_mat(hub, rim_mat)
    hub.parent = root

    face = _cylinder_x("rim_face", RIM_RADIUS_M, TIRE_WIDTH_M * 0.22, segments=28)
    _assign_mat(face, rim_mat)
    face.parent = root

    spoke_len = RIM_RADIUS_M * 1.55
    spoke_w = RIM_RADIUS_M * 0.22
    _add_spokes(root, rim_mat, 5 if s != "rally" else 6, spoke_len, spoke_w, TIRE_WIDTH_M * 0.16)

    if s == "neon":
        bpy.ops.mesh.primitive_torus_add(
            major_radius=RIM_RADIUS_M * 0.92,
            minor_radius=TIRE_WIDTH_M * 0.07,
            major_segments=40,
            minor_segments=12,
            location=(0.0, 0.0, 0.0),
        )
        ring = bpy.context.active_object
        ring.name = "neon_ring"
        ring.rotation_euler = (0.0, math.pi / 2.0, 0.0)
        glow = _mat(
            "neon_glow",
            Base_Color=(0.0, 1.0, 1.0, 1.0),
            Emission=(0.0, 1.0, 1.0, 1.0),
            Emission_Strength=8.0,
            Roughness=0.1,
            Metallic=0.5,
        )
        _assign_mat(ring, glow)
        ring.parent = root

    return root


def _center_and_export(root: bpy.types.Object, output_path: str) -> None:
    bpy.context.view_layer.update()
    meshes = [c for c in root.children_recursive if c.type == "MESH"]
    if not meshes:
        raise SystemExit("brak mesh w kole")
    bpy.ops.object.select_all(action="DESELECT")
    for m in meshes:
        m.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    bpy.ops.object.join()
    joined = bpy.context.view_layer.objects.active
    joined.name = "wheel"
    bpy.ops.object.origin_set(type="ORIGIN_GEOMETRY", center="BOUNDS")
    bpy.context.view_layer.update()

    dims = joined.dimensions
    if dims.z <= dims.x and dims.z <= dims.y:
        joined.rotation_euler = (0.0, math.pi / 2.0, 0.0)
        bpy.ops.object.transform_apply(rotation=True)
        bpy.ops.object.origin_set(type="ORIGIN_GEOMETRY", center="BOUNDS")
    elif dims.y <= dims.x and dims.y <= dims.z:
        joined.rotation_euler = (0.0, 0.0, math.pi / 2.0)
        bpy.ops.object.transform_apply(rotation=True)
        bpy.ops.object.origin_set(type="ORIGIN_GEOMETRY", center="BOUNDS")

    bpy.context.view_layer.update()

    os.makedirs(os.path.dirname(output_path) or ".", exist_ok=True)
    bpy.ops.object.select_all(action="DESELECT")
    joined.select_set(True)
    bpy.context.view_layer.objects.active = joined
    bpy.ops.export_scene.gltf(
        filepath=output_path,
        export_format="GLB",
        use_selection=True,
        export_apply=True,
    )


def main() -> None:
    style, output_path = _argv()
    if style not in STYLES:
        raise SystemExit(f"Nieznany styl: {style} ({', '.join(STYLES)})")
    _clear()
    root = _build_wheel(style)
    _center_and_export(root, output_path)
    print(f"blender_gen_wheel: {output_path} style={style} D={WHEEL_DIAMETER_M}m")


if __name__ == "__main__":
    main()
