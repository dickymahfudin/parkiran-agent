# Run: Blender --background --python scripts/blender/make_character.py -- <repo_root>
# Builds the base "kaos + celana" character with MPFB (CC0/CC-BY assets) and the MPFB "mixamo" rig into
# character.blend. make_animations.py adds the clips and exports the GLB.
import glob
import json
import os
import sys

import bpy
import numpy as np
from mathutils.bvhtree import BVHTree
from bl_ext.user_default.mpfb.services.assetservice import AssetService
from bl_ext.user_default.mpfb.services.humanservice import HumanService
from bl_ext.user_default.mpfb.services.locationservice import LocationService

REPO = os.path.abspath(sys.argv[sys.argv.index("--") + 1])
RAW = os.path.join(REPO, "assets", "raw", "makehuman")
OUT = os.path.join(REPO, "assets", "generated", "character")

SHIRTS = {"Shirt_Tee": "toigo_basic_tucked_t-shirt", "Shirt_Polo": "namuhekam_male_polo_shirt"}
LEGS = {"Shorts": "elvs_male_swim_shorts1", "Trunks": "mindfront_male_swimming_trunks_01", "Pants": "cortu_cargo_pants"}
HAIRS = ["short02", "short01", "short04"]
# Diffuse textures of these parts are converted to neutral grey so the app can tint them per session.
TINTABLE = list(SHIRTS) + list(LEGS)
# Printed all over (tie-dye); replaced by plain fabric noise instead of a greyscale copy.
PLAIN_FABRIC = {"Shorts"}
GREY_TARGET_MEAN = 0.78
# The CC0 tee is cut to be tucked in; an untucked kaos oblong needs a longer, slightly looser hem.
TEE_EXTEND_M = 0.08
TEE_HEM_BAND_M = 0.14
TEE_HEM_FLARE = 0.045


def install_packs():
    user_data = LocationService.get_user_data()
    marker = os.path.join(user_data, "parkiran_packs.json")
    zips = sorted(glob.glob(os.path.join(RAW, "*", "*.zip")))
    installed = json.load(open(marker)) if os.path.exists(marker) else []
    for z in zips:
        if os.path.basename(z) in installed:
            continue
        err = AssetService.fix_and_extract_asset_pack_zip(z, user_data)
        if err:
            raise RuntimeError(f"asset pack {z}: {err}")
        installed.append(os.path.basename(z))
    with open(marker, "w") as f:
        json.dump(installed, f)
    AssetService.update_all_asset_lists()


def asset(name, subdir):
    path = AssetService.find_asset_absolute_path(f"{name}.mhclo", asset_subdir=subdir)
    if path is None:
        raise RuntimeError(f"asset not found: {subdir}/{name}")
    return path


def build_human():
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)

    info = HumanService._create_default_human_info_dict()
    info["name"] = "Parkiran"
    info["phenotype"] = {
        "gender": 1.0,
        "age": 0.5,
        "muscle": 0.5,
        "weight": 0.45,
        "proportions": 0.55,
        "height": 0.5,
        "cupsize": 0.5,
        "firmness": 0.5,
        "race": {"asian": 0.8, "caucasian": 0.1, "african": 0.1},
    }
    info["rig"] = "mixamo"
    info["eyes"] = "low-poly.mhclo"
    info["eyebrows"] = "eyebrow001.mhclo"
    info["eyelashes"] = "eyelashes01.mhclo"
    info["hair"] = f"{HAIRS[0]}.mhclo"
    info["skin_mhmat"] = "young_asian_male.mhmat"
    info["skin_material_type"] = "GAMEENGINE"
    info["eyes_material_type"] = "GAMEENGINE"
    info["clothes_material_type"] = "GAMEENGINE"
    info["clothes"] = [f"{name}.mhclo" for name in [*SHIRTS.values(), *LEGS.values()]]

    settings = HumanService.get_default_deserialization_settings()
    settings["subdiv_levels"] = 0
    basemesh = HumanService.deserialize_from_dict(info, settings)

    for hair in HAIRS[1:]:
        HumanService.add_mhclo_asset(asset(hair, "hair"), basemesh, asset_type="hair", subdiv_levels=0, material_type="GAMEENGINE")
    return basemesh


def apply_shape_keys(obj):
    if obj.data.shape_keys is None:
        return
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.shape_key_remove(all=True, apply_mix=True)


COVER_RAY_MAX_M = 0.06


def covered_vertices(body, garment_obj):
    """Body vertices whose outward normal ray hits the garment within a few cm, eroded by one ring
    so skin stays under garment edges when animated."""
    depsgraph = bpy.context.evaluated_depsgraph_get()
    tree = BVHTree.FromObject(garment_obj, depsgraph)
    to_garment = garment_obj.matrix_world.inverted() @ body.matrix_world
    rot = to_garment.to_3x3()
    hit = set()
    for v in body.data.vertices:
        origin = to_garment @ v.co
        direction = (rot @ v.normal).normalized()
        if tree.ray_cast(origin, direction, COVER_RAY_MAX_M)[0] is not None:
            hit.add(v.index)
    neighbours = {i: set() for i in hit}
    for e in body.data.edges:
        a, b = e.vertices
        if a in neighbours:
            neighbours[a].add(b)
        if b in neighbours:
            neighbours[b].add(a)
    return {i for i in hit if neighbours[i] <= hit}


def make_body_variants(basemesh):
    """One body per leg garment. The torso is hidden only where every shirt option covers it."""
    apply_shape_keys(basemesh)
    garments = {o.name.split(".", 1)[1]: o for o in basemesh.parent.children if "." in o.name}
    torso = set.intersection(*(covered_vertices(basemesh, garments[name]) for name in SHIRTS.values()))
    for mod in list(basemesh.modifiers):
        if mod.type == "MASK" and mod.name.startswith("Delete."):
            basemesh.modifiers.remove(mod)
    for part, garment in LEGS.items():
        body = basemesh.copy()
        body.data = basemesh.data.copy()
        body.name = f"Body_{part}"
        body.data.name = body.name
        basemesh.users_collection[0].objects.link(body)
        hidden = torso | covered_vertices(basemesh, garments[garment])
        group = body.vertex_groups.new(name="ParkiranHidden")
        group.add(sorted(hidden), 1.0, "REPLACE")
        mask = body.modifiers.new("ParkiranHidden", "MASK")
        mask.vertex_group = "ParkiranHidden"
        mask.invert_vertex_group = True
        bpy.ops.object.select_all(action="DESELECT")
        bpy.context.view_layer.objects.active = body
        body.select_set(True)
        for mod in list(body.modifiers):
            if mod.type == "MASK":
                bpy.ops.object.modifier_apply(modifier=mod.name)
        for g in list(body.vertex_groups):
            if not g.name.startswith("mixamorig:"):
                body.vertex_groups.remove(g)
    bpy.data.objects.remove(basemesh, do_unlink=True)


def lengthen_tee(tee):
    mesh = tee.data
    zs = [v.co.z for v in mesh.vertices]
    z_min = min(zs)
    band = [v for v in mesh.vertices if v.co.z < z_min + TEE_HEM_BAND_M]
    cx = sum(v.co.x for v in band) / len(band)
    cy = sum(v.co.y for v in band) / len(band)
    for v in band:
        t = 1.0 - (v.co.z - z_min) / TEE_HEM_BAND_M
        v.co.z -= TEE_EXTEND_M * t
        v.co.x = cx + (v.co.x - cx) * (1.0 + TEE_HEM_FLARE * t)
        v.co.y = cy + (v.co.y - cy) * (1.0 + TEE_HEM_FLARE * t)
    mesh.update()


ALPHA_CUTOUT_PREFIXES = ("Hair_", "Eyebrows", "Eyelashes")


def fix_alpha(obj):
    """glTF exporter: no alpha link -> OPAQUE, alpha through Round -> MASK (cutoff 0.5)."""
    mat = obj.active_material
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    bsdf = next(n for n in nodes if n.type == "BSDF_PRINCIPLED")
    alpha_in = bsdf.inputs["Alpha"]
    source = alpha_in.links[0].from_socket if alpha_in.links else None
    for link in list(alpha_in.links):
        links.remove(link)
    if source is not None and obj.name.startswith(ALPHA_CUTOUT_PREFIXES):
        rnd = nodes.new("ShaderNodeMath")
        rnd.operation = "ROUND"
        links.new(source, rnd.inputs[0])
        links.new(rnd.outputs[0], alpha_in)
    mat.name = obj.name


def box_blur(a, r):
    padded = np.pad(a, r + 1, mode="edge")
    c = padded.cumsum(0).cumsum(1)
    k = 2 * r + 1
    s = c[k:, k:] - c[:-k, k:] - c[k:, :-k] + c[:-k, :-k]
    return s[: a.shape[0], : a.shape[1]] / (k * k)


def greyscale_diffuse(obj):
    mat = obj.active_material
    images = {n.image for n in mat.node_tree.nodes if n.type == "TEX_IMAGE" and n.image and n.image.colorspace_settings.name == "sRGB"}
    for img in images:
        w, h = img.size
        px = np.array(img.pixels[:], dtype=np.float32).reshape(h, w, 4)
        lum = px[..., 0] * 0.2126 + px[..., 1] * 0.7152 + px[..., 2] * 0.0722
        opaque = px[..., 3] > 0.5
        mean = float(lum[opaque].mean()) if opaque.any() else 0.5
        # Keep fabric detail (high frequencies), flatten printed patterns and baked shading.
        if obj.name in PLAIN_FABRIC:
            noise = np.random.default_rng(7).normal(0.0, 0.05, (h, w)).astype(np.float32)
            grey = np.clip(GREY_TARGET_MEAN + box_blur(noise, 1) * 1.6, 0.0, 1.0)
        else:
            low = box_blur(lum, max(4, w // 48))
            scale = GREY_TARGET_MEAN / max(mean, 1e-3)
            grey = np.clip(GREY_TARGET_MEAN + 0.12 * (low * scale - GREY_TARGET_MEAN) + 0.9 * (lum - low) * scale, 0.0, 1.0)
        out = np.stack([grey, grey, grey, px[..., 3]], axis=-1)
        new = bpy.data.images.new(f"{obj.name}_grey", w, h, alpha=True)
        new.pixels = out.ravel()
        path = os.path.join(OUT, "textures", f"{obj.name.lower()}_grey.png")
        os.makedirs(os.path.dirname(path), exist_ok=True)
        new.filepath_raw = path
        new.file_format = "PNG"
        new.save()
        for n in mat.node_tree.nodes:
            if n.type == "TEX_IMAGE" and n.image == img:
                n.image = new


def rename_parts(rig):
    names = {garment: part for part, garment in {**SHIRTS, **LEGS}.items()}
    names.update({
        "low-poly": "Eyes",
        "eyebrow001": "Eyebrows",
        "eyelashes01": "Eyelashes",
    })
    for hair in HAIRS:
        names[hair] = f"Hair_{hair}"
    for child in rig.children:
        for key, nice in names.items():
            if child.name.endswith("." + key):
                child.name = nice
                child.data.name = nice
        for mod in list(child.modifiers):
            if mod.type == "SUBSURF":
                child.modifiers.remove(mod)
    rig.name = "Parkiran"


def write_report(rig):
    body = next(c for c in rig.children if c.name.startswith("Body"))
    zs = [(body.matrix_world @ v.co).z for v in body.data.vertices]
    report = {
        "objects": [{"name": c.name, "verts": len(c.data.vertices), "polys": len(c.data.polygons)} for c in rig.children],
        "bones": len(rig.data.bones),
        "height_m": round(max(zs) - min(zs), 3),
    }
    with open(os.path.join(OUT, "report.json"), "w") as f:
        json.dump(report, f, indent=2)


install_packs()
basemesh = build_human()
rig = basemesh.parent
if rig is None or rig.type != "ARMATURE":
    raise RuntimeError("expected the basemesh to be parented to the mixamo rig")
lengthen_tee(next(c for c in rig.children if c.name.endswith("." + SHIRTS["Shirt_Tee"])))
make_body_variants(basemesh)
rename_parts(rig)
os.makedirs(OUT, exist_ok=True)
for child in rig.children:
    if child.name in TINTABLE:
        greyscale_diffuse(child)
    fix_alpha(child)
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, "character.blend"))
write_report(rig)
print("PARKIRAN_DONE", OUT)
