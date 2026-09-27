# Run: Blender --background --factory-startup --python scripts/blender/render_clips.py -- <character.glb> <out_dir> <clip:seconds> ...
# Renders the exported GLB (exactly what the web app loads) at given clip times, one PNG per pose, for visual review.
import math
import os
import sys

import bpy
from mathutils import Vector

args = sys.argv[sys.argv.index("--") + 1:]
glb, out_dir, shots = args[0], args[1], args[2:]
# CLOSE=1 frames the lap and hands to check contact with the thighs and the laptop.
close = os.environ.get("CLOSE") == "1"
# FOCUS=<bone> (e.g. mixamorigRightHand) frames that bone from the front-right in every shot, to check hand orientation.
focus = os.environ.get("FOCUS")
os.makedirs(out_dir, exist_ok=True)

for o in list(bpy.data.objects):
    bpy.data.objects.remove(o, do_unlink=True)
bpy.ops.import_scene.gltf(filepath=glb)
rig = next(o for o in bpy.data.objects if o.type == "ARMATURE")
VISIBLE = {"Body_Shorts", "Shirt_Tee", "Shorts", "Hair_short02", "Eyes", "Eyebrows", "Eyelashes"}
for o in bpy.data.objects:
    if o.type == "MESH":
        o.hide_render = o.name not in VISIBLE

scene = bpy.context.scene
scene.render.engine = "BLENDER_EEVEE"
scene.render.resolution_x = 360
scene.render.resolution_y = 440
scene.render.fps = 24
scene.view_settings.view_transform = "AgX"
world = bpy.data.worlds.new("World")
world.use_nodes = True
world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.5, 0.55, 0.6, 1)
world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.8
scene.world = world
sun = bpy.data.objects.new("Sun", bpy.data.lights.new("Sun", "SUN"))
sun.data.energy = 3.5
sun.rotation_euler = (math.radians(50), 0, math.radians(30))
scene.collection.objects.link(sun)

# Seat and lap props so sitting and typing read correctly.
bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0.33, 0.225))
seat = bpy.context.object
seat.scale = (0.9, 0.4, 0.45)
# Laptop on the lap, where the web app puts it (glTF (0, 0.638, 0.081) → Blender (0, -0.081, 0.638)).
bpy.ops.mesh.primitive_cube_add(size=1, location=(0, -0.081, 0.638))
laptop = bpy.context.object
laptop.scale = (0.33, 0.23, 0.018)
bpy.ops.mesh.primitive_cube_add(size=1, location=(0, -0.21, 0.75))
lid = bpy.context.object
lid.scale = (0.33, 0.01, 0.23)
lid.rotation_euler = (math.radians(-12), 0, 0)
bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, -0.01))
floor = bpy.context.object
floor.scale = (4, 4, 0.02)

cam = bpy.data.objects.new("Cam", bpy.data.cameras.new("Cam"))
cam.data.lens = 50
cam.location = Vector((0.75, -1.25, 1.0)) if close else Vector((1.9, -2.6, 1.35))
# VIEW=x,y,z moves the camera (Blender coordinates; the character faces -Y), e.g. 0,2.2,1.5 to look from behind.
if os.environ.get("VIEW"):
    cam.location = Vector(tuple(float(v) for v in os.environ["VIEW"].split(",")))
look_at = Vector((0, 0.0, 0.62)) if close else Vector((0, 0.1, 0.85))
if os.environ.get("VIEW"):
    look_at = Vector((0, 0.15, 1.0))
cam.rotation_euler = (look_at - cam.location).to_track_quat("-Z", "Y").to_euler()
scene.collection.objects.link(cam)
scene.camera = cam

rig.animation_data_create()
for shot in shots:
    name, sec = shot.split(":")
    act = bpy.data.actions.get(name)
    if act is None:
        print("PARKIRAN_MISSING", name)
        continue
    rig.animation_data.action = act
    if act.slots:
        rig.animation_data.action_slot = act.slots[0]
    seated = name in {"sitIdle", "chat", "type", "think", "smoke", "sip", "stretch", "frustrated", "doze", "stubOut", "closeLaptop", "lightUp", "phone"}
    seat.hide_render = not (seated or name in {"sitDown", "standUp"})
    laptop.hide_render = lid.hide_render = not seated
    scene.frame_set(int(round(float(sec) * 24)))
    if focus:
        at = rig.matrix_world @ rig.pose.bones[focus].head
        # With VIEW set too, VIEW is the camera offset from the bone instead of a position.
        offset = Vector(tuple(float(v) for v in os.environ["VIEW"].split(","))) if os.environ.get("VIEW") else Vector((0.28, -0.5, 0.12))
        cam.location = at + offset
        cam.rotation_euler = (at - cam.location).to_track_quat("-Z", "Y").to_euler()
    scene.render.filepath = os.path.join(out_dir, f"{name}-{sec}.png")
    bpy.ops.render.render(write_still=True)
print("PARKIRAN_RENDERED", len(shots))
