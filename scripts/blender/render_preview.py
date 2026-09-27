# Run: Blender --background assets/generated/character/character.blend --python scripts/blender/render_preview.py -- <out.png>
# Renders three variants side by side for a quick look review.
import math
import sys

import bpy
from mathutils import Vector

out = sys.argv[sys.argv.index("--") + 1]
rig = bpy.data.objects["Parkiran"]

VARIANTS = [
    {"legs": "Shorts", "shirt": "Shirt_Tee", "hair": "Hair_short02", "shirt_rgb": (0.62, 0.08, 0.07), "legs_rgb": (0.10, 0.12, 0.16)},
    {"legs": "Pants", "shirt": "Shirt_Tee", "hair": "Hair_short01", "shirt_rgb": (0.85, 0.83, 0.78), "legs_rgb": (0.16, 0.24, 0.40)},
    {"legs": "Trunks", "shirt": "Shirt_Polo", "hair": "Hair_short04", "shirt_rgb": (0.10, 0.28, 0.20), "legs_rgb": (0.55, 0.48, 0.36)},
    {"legs": "Shorts", "shirt": "Shirt_Tee", "hair": "Hair_short01", "shirt_rgb": (0.95, 0.70, 0.12), "legs_rgb": (0.30, 0.30, 0.32)},
]
SWITCHABLE = {
    "Body_Shorts", "Body_Pants", "Body_Trunks", "Shorts", "Pants", "Trunks",
    "Shirt_Tee", "Shirt_Polo", "Hair_short01", "Hair_short02", "Hair_short04",
}


def tint(obj, rgb):
    mat = obj.active_material.copy()
    obj.active_material = mat
    for node in mat.node_tree.nodes:
        if node.type == "BSDF_PRINCIPLED":
            link = node.inputs["Base Color"].links
            if link:
                mix = mat.node_tree.nodes.new("ShaderNodeMix")
                mix.data_type = "RGBA"
                mix.blend_type = "MULTIPLY"
                mix.inputs["Factor"].default_value = 1.0
                mat.node_tree.links.new(link[0].from_socket, mix.inputs["A"])
                mix.inputs["B"].default_value = (*rgb, 1.0)
                mat.node_tree.links.new(mix.outputs["Result"], node.inputs["Base Color"])
            else:
                node.inputs["Base Color"].default_value = (*rgb, 1.0)


def copy_character(offset_x):
    new_rig = rig.copy()
    new_rig.data = rig.data.copy()
    bpy.context.scene.collection.objects.link(new_rig)
    new_rig.location.x += offset_x
    children = {}
    for child in rig.children:
        c = child.copy()
        c.data = child.data.copy()
        bpy.context.scene.collection.objects.link(c)
        c.parent = new_rig
        for mod in c.modifiers:
            if mod.type == "ARMATURE":
                mod.object = new_rig
        children[child.name] = c
    return new_rig, children


for i, v in enumerate(VARIANTS):
    _, parts = copy_character((i - 1.5) * 0.75)
    visible = {f"Body_{v['legs']}", v["legs"], v["shirt"], v["hair"]}
    for name, obj in parts.items():
        if name in SWITCHABLE and name not in visible:
            obj.hide_render = True
    tint(parts[v["shirt"]], v["shirt_rgb"])
    tint(parts[v["legs"]], v["legs_rgb"])
for child in rig.children:
    child.hide_render = True

scene = bpy.context.scene
scene.render.engine = "BLENDER_EEVEE"
scene.render.resolution_x = 1600
scene.render.resolution_y = 1000
scene.render.filepath = out
scene.view_settings.view_transform = "AgX"

world = bpy.data.worlds.new("World")
world.use_nodes = True
world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.55, 0.6, 0.65, 1)
world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.6
scene.world = world

sun = bpy.data.objects.new("Sun", bpy.data.lights.new("Sun", "SUN"))
sun.data.energy = 3.5
sun.rotation_euler = (math.radians(50), 0, math.radians(30))
scene.collection.objects.link(sun)

bpy.ops.mesh.primitive_plane_add(size=12)
ground = bpy.context.active_object
gmat = bpy.data.materials.new("Ground")
gmat.use_nodes = True
gmat.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.18, 0.18, 0.19, 1)
ground.data.materials.append(gmat)

cam = bpy.data.objects.new("Cam", bpy.data.cameras.new("Cam"))
cam.data.lens = 50
cam.location = Vector((0.6, -5.2, 1.3))
direction = Vector((0, 0, 0.85)) - cam.location
cam.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
scene.collection.objects.link(cam)
scene.camera = cam

bpy.ops.render.render(write_still=True)
print("PARKIRAN_RENDERED", out)
