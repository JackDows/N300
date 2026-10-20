"""DeskHub studio: reproducible geometry, one camera and one lighting rig.

Visual ranking: physical devices first, selected part second, supporting UI last.
The same key meshes/part hierarchy are exported for both desk and focus states.
No raster device cutouts are used. All distances are metres.
"""
import argparse
import json
import math
import pathlib
import sys
import bpy
from mathutils import Vector

ROOT = pathlib.Path(__file__).resolve().parents[2]
args = argparse.ArgumentParser()
args.add_argument('--render', action='store_true')
args.add_argument('--draft', action='store_true')
args.add_argument('--out', default=str(ROOT / 'artifacts/visual/studio-v1'))
opt = args.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])
OUT = pathlib.Path(opt.out)
OUT.mkdir(parents=True, exist_ok=True)
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
scene = bpy.context.scene
scene.unit_settings.system = 'METRIC'
scene.render.engine = 'CYCLES'
scene.cycles.samples = 32 if opt.draft else 96
scene.cycles.use_denoising = True
scene.cycles.max_bounces = 8
scene.cycles.transmission_bounces = 6
prefs = bpy.context.preferences.addons['cycles'].preferences
use_gpu = False
try:
    prefs.compute_device_type = 'OPTIX'
    prefs.get_devices()
    for device in prefs.devices:
        device.use = device.type == 'OPTIX'
        use_gpu |= device.use
except (TypeError, RuntimeError):
    pass
scene.cycles.device = 'GPU' if use_gpu else 'CPU'
scene.render.resolution_x = 1600 if opt.draft else 2400
scene.render.resolution_y = 1000 if opt.draft else 1500
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = 'PNG'
scene.render.film_transparent = False
scene.view_settings.view_transform = 'AgX'
scene.view_settings.look = 'AgX - Medium High Contrast'
scene.view_settings.exposure = -.45
scene.world.use_nodes = True
scene.world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.07, 0.075, 0.08, 1)
scene.world.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.25

def linear(hex_color):
    def channel(c):
        return c / 12.92 if c < .04045 else ((c + .055) / 1.055) ** 2.4
    return tuple(channel(int(hex_color[i:i+2], 16) / 255) for i in (0, 2, 4)) + (1,)

def material(name, color, rough=.4, metal=0, emission=0, transmission=0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    m.diffuse_color = linear(color)
    p = m.node_tree.nodes.get('Principled BSDF')
    p.inputs['Base Color'].default_value = linear(color)
    p.inputs['Roughness'].default_value = rough
    p.inputs['Metallic'].default_value = metal
    p.inputs['Transmission Weight'].default_value = transmission
    p.inputs['IOR'].default_value = 1.46
    if emission:
        p.inputs['Emission Color'].default_value = linear(color)
        p.inputs['Emission Strength'].default_value = emission
    return m

M = {
    'desk': material('Desk / charcoal satin', '262C30', .39, .22),
    'wall': material('Wall / graphite', '171C20', .88),
    'shell': material('Shell / graphite polymer', '292F34', .35, .12),
    'black': material('Recess / near black', '10151A', .52),
    'rubber': material('Soft rubber', '171C20', .82),
    'silver': material('Machined aluminium', '65747C', .29, .82),
    'steel': material('Dark anodised aluminium', '4B555B', .3, .72),
    'key': material('Keycap / charcoal PBT', '343D43', .62),
    'mod': material('Keycap / warm grey PBT', 'A0A29B', .65),
    'legend': material('Key legends / ivory', 'E2E5DF', .45),
    'ink': material('Dark printed legends', '242A2D', .5),
    'ivory': material('Mouse / neutral ivory', 'D9DCD5', .48),
    'thread': material('Pad stitching', '343D43', .9),
    'screen': material('Screen / midnight glass', '07141A', .18, .18),
    'cyan': material('Screen light / ice', '82DBE0', .3, 0, 1.1),
    'trace': material('Screen light / secondary', '345D66', .5, 0, .2),
    'kb_led': material('Keyboard diffuser', '82DBE0', .35, 0, 2),
    'pc_led': material('Case diffuser', '72BCC4', .28, 0, 1.3),
    'status': material('Speaker indicator', 'A5DCE0', .3, 0, 1.4),
    'cone': material('Woven speaker cone', '303A40', .62, .1),
    'glass': material('Clear tempered side panel', 'EEF5F6', .055, 0, 0, 1),
    'copper': material('Contacts', '9C8353', .35, .65),
    'pcb': material('Motherboard solder mask', '19292C', .48, .1),
}

def root(name, loc=(0, 0, 0), parent=None, **metadata):
    ob = bpy.data.objects.new(name, None)
    scene.collection.objects.link(ob)
    ob.parent = parent
    ob.location = loc
    for key, value in metadata.items():
        ob[key] = value
    return ob

def finish(ob, name, loc, mat, parent):
    ob.name = name
    ob.location = loc
    ob.parent = parent
    if mat:
        ob.data.materials.append(mat)
    return ob

def box(name, size, loc, mat, bevel=.002, parent=None):
    bpy.ops.mesh.primitive_cube_add(size=1)
    ob = bpy.context.object
    ob.dimensions = size
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    finish(ob, name, loc, mat, parent)
    if bevel:
        mod = ob.modifiers.new('Soft machined edges', 'BEVEL')
        mod.width = min(bevel, min(size) * .45)
        mod.segments = 6 if bevel >= .004 else 3
        mod.harden_normals = True
        normal = ob.modifiers.new('Weighted face normals', 'WEIGHTED_NORMAL')
        normal.keep_sharp = True
    return ob

def cylinder(name, r, depth, loc, mat, axis='Z', parent=None, vertices=64):
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=r, depth=depth)
    ob = finish(bpy.context.object, name, loc, mat, parent)
    ob.rotation_euler = {'X': (0, math.pi/2, 0), 'Y': (math.pi/2, 0, 0), 'Z': (0, 0, 0)}[axis]
    for face in ob.data.polygons:
        face.use_smooth = len(face.vertices) == 4
    bevel = ob.modifiers.new('Edge chamfer', 'BEVEL')
    bevel.width = min(.0006, depth * .2)
    bevel.segments = 3
    return ob

def ring(name, radius, thickness, loc, mat, axis='Z', parent=None):
    bpy.ops.mesh.primitive_torus_add(major_radius=radius, minor_radius=thickness, major_segments=64, minor_segments=10)
    ob = finish(bpy.context.object, name, loc, mat, parent)
    ob.rotation_euler = {'X': (0, math.pi/2, 0), 'Y': (math.pi/2, 0, 0), 'Z': (0, 0, 0)}[axis]
    for face in ob.data.polygons:
        face.use_smooth = True
    return ob

def line(name, points, radius, mat, parent=None, smooth=True):
    curve = bpy.data.curves.new(name, 'CURVE')
    curve.dimensions = '3D'
    curve.resolution_u = 16
    curve.bevel_depth = radius
    curve.bevel_resolution = 3
    spline = curve.splines.new('BEZIER' if smooth else 'POLY')
    if smooth:
        spline.bezier_points.add(len(points)-1)
        for point, co in zip(spline.bezier_points, points):
            point.co = co
            point.handle_left_type = point.handle_right_type = 'AUTO'
    else:
        spline.points.add(len(points)-1)
        for point, co in zip(spline.points, points):
            point.co = (*co, 1)
    ob = bpy.data.objects.new(name, curve)
    scene.collection.objects.link(ob)
    ob.parent = parent
    ob.data.materials.append(mat)
    return ob

font_path = ROOT / 'design/studio/Inter.ttf'
font = bpy.data.fonts.load(str(font_path)) if font_path.exists() else None
if font: font.pack()

def text(name, body, loc, size, mat, parent=None, rotation=(0, 0, 0)):
    curve = bpy.data.curves.new(name, 'FONT')
    curve.body = body
    curve.size = size
    curve.align_x = 'CENTER'
    curve.align_y = 'CENTER'
    curve.extrude = .000008
    curve.resolution_u = 5
    if font:
        curve.font = font
    ob = bpy.data.objects.new(name, curve)
    scene.collection.objects.link(ob)
    ob.parent = parent
    ob.location = loc
    ob.rotation_euler = rotation
    ob.data.materials.append(mat)
    return ob

def screw(name, loc, parent=None, axis='Z', radius=.002):
    ob = cylinder(name, radius, .001, loc, M['steel'], axis, parent, 12)
    return ob

# A single physical desk and backdrop provide all contact shadows and reflections.
environment = root('environment')
box('desk.slab', (1.82, .88, .035), (0, 0, -.018), M['desk'], .012, environment)
box('desk.front.inlay', (1.76, .002, .002), (0, -.436, -.012), M['steel'], .0005, environment)
# Planar corner radii are independent of the 3 mm thickness of the mousepad.
pad_w,pad_d,pad_r=.78,.33,.014
def pad_outline(inset=0):
    points=[];rw=pad_w-2*inset;rd=pad_d-2*inset;r=pad_r-inset
    for corner in range(4):
        cx=(rw/2-r)*(1 if corner in (0,3) else -1);cy=(rd/2-r)*(1 if corner in (0,1) else -1)
        for i in range(12):
            angle=corner*math.pi/2+i/11*math.pi/2
            points.append((cx+r*math.cos(angle),cy+r*math.sin(angle)))
    return points
outline=pad_outline();count=len(outline)
vertices=[(x,y,z) for z in (-.0015,.0015) for x,y in outline]
faces=[tuple(range(count-1,-1,-1)),tuple(range(count,count*2))]
faces.extend((i,(i+1)%count,(i+1)%count+count,i+count) for i in range(count))
mesh=bpy.data.meshes.new('desk.pad');mesh.from_pydata(vertices,[],faces);mesh.update()
pad=bpy.data.objects.new('desk.pad',mesh);scene.collection.objects.link(pad);finish(pad,'desk.pad',(-.12,-.225,.002),M['rubber'],environment)
bevel=pad.modifiers.new('Soft fabric edge','BEVEL');bevel.width=.00035;bevel.segments=3
stitches=bpy.data.curves.new('desk.pad.stitches','CURVE');stitches.dimensions='3D';stitches.bevel_depth=.00013;stitches.bevel_resolution=2
outline=pad_outline(.004)
for a,b in zip(outline,outline[1:]+outline[:1]):
    length=math.dist(a,b);steps=max(1,round(length/.004))
    for i in range(steps):
        spline=stitches.splines.new('POLY');spline.points.add(1)
        for point,t in zip(spline.points,((i+.15)/steps,(i+.65)/steps)):
            point.co=(a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t,.00162,1)
ob=bpy.data.objects.new('desk.pad.stitches',stitches);scene.collection.objects.link(ob);ob.parent=pad;stitches.materials.append(M['thread'])
box('backdrop', (8, .12, 5), (0, .68, 1.2), M['wall'], .01, environment)
for index in range(20):
    x = -.89 + index * .035
    box(f'wall.fins.{index}', (.006, .026, .66), (x, .607, .31), M['shell'], .001, environment)
box('wall.lower.trim', (1.8, .018, .015), (0, .60, .025), M['black'], .002, environment)
box('wall.diffuser', (1.20,.003,.002),(-.12,.588,.032),M['pc_led'],.0006,environment)

# Monitor: thin bezel, a physically joined stand, restrained generated display geometry.
monitor = root('device.monitor', (-.14, .235, 0), device_id='system')
box('monitor.body', (.615, .026, .36), (0, 0, .345), M['shell'], .006, monitor)
box('monitor.display', (.594, .0014, .334), (0, -.014, .347), M['screen'], .003, monitor)
box('monitor.chin', (.603, .003, .009), (0, -.014, .172), M['black'], .002, monitor)
text('monitor.wordmark', 'AOC', (0, -.016, .172), .004, M['steel'], monitor, (math.pi/2, 0, 0))
box('monitor.neck', (.041, .034, .18), (0, .018, .103), M['steel'], .004, monitor)
box('monitor.stand.joint', (.056,.063,.016),(0,-.002,.018),M['steel'],.004,monitor)
for sign in (-1, 1):
    foot = box(f'monitor.foot.{sign}', (.20, .033, .012), (sign*.082, -.027, .013), M['steel'], .005, monitor)
    foot.rotation_euler.z = sign * -.28
box('monitor.indicator', (.008, .0012, .001), (.25, -.017, .172), M['status'], .0003, monitor)
text('monitor.brand', 'DeskHub', (-.175, -.016, .448), .034, M['legend'], monitor, (math.pi/2, 0, 0))
text('monitor.subtitle', 'YOUR SPACE. CONNECTED.', (-.177, -.016, .424), .0065, M['trace'], monitor, (math.pi/2, 0, 0))
for j in range(9):
    points = []
    for i in range(45):
        x = -.278 + i/44*.556
        z = .28 + j*.0065 + .035*math.sin(x*11 + j*.09) + .016*math.cos(x*23-j*.035)
        points.append((x, -.0161, z))
    line(f'monitor.display.trace.{j}', points, .00042, M['cyan'] if j in (2,6) else M['trace'], monitor)

def speaker(name, x):
    parent = root(name, (x, .105, .007), device_id='speaker')
    box(name+'.cabinet', (.102, .125, .168), (0, 0, .09), M['shell'], .008, parent)
    for z, radius in ((.062, .037), (.137, .012)):
        cylinder(name+'.driver.well', radius+.003, .003, (0, -.065, z), M['black'], 'Y', parent)
        ring(name+'.driver.rim', radius+.001, .0011, (0, -.068, z), M['steel'], 'Y', parent)
        ring(name+'.driver.surround', radius*.86, radius*.09, (0, -.069, z), M['rubber'], 'Y', parent)
        # Cone is a true profile of revolution, with a recessed diaphragm and domed dust cap.
        vertices, faces = [], []
        profile = [(radius*.78, -.070), (radius*.64, -.067), (radius*.40, -.060), (.001, -.060)]
        for r, y in profile:
            vertices.extend((math.cos(i/64*math.tau)*r, y, z+math.sin(i/64*math.tau)*r) for i in range(64))
        for k in range(len(profile)-1):
            for i in range(64):
                faces.append((k*64+i, k*64+(i+1)%64, (k+1)*64+(i+1)%64, (k+1)*64+i))
        mesh=bpy.data.meshes.new(name+'.cone');mesh.from_pydata(vertices,[],faces);mesh.update()
        ob=bpy.data.objects.new(name+'.cone',mesh);scene.collection.objects.link(ob);ob.parent=parent;mesh.materials.append(M['cone'])
        for face in mesh.polygons: face.use_smooth=True
        bpy.ops.mesh.primitive_uv_sphere_add(segments=32, ring_count=16, radius=radius*.32)
        dome=finish(bpy.context.object,name+'.dustcap',(0,-.064,z),M['black'],parent);dome.scale.y=.5
        for face in dome.data.polygons:face.use_smooth=True
    text(name+'.label','N300',(0,-.065,.024),.0032,M['steel'],parent,(math.pi/2,0,0))
    box(name+'.indicator',(.005,.0015,.001),(0,-.064,.016),M['status'],.0003,parent)
    box(name+'.base',(.094,.096,.007),(0,0,.004),M['black'],.004,parent)
    return parent

speaker('device.speaker.left', -.535)
speaker('device.speaker.right', .282)

# Actual OG98 key map; only the small keycap geometry is shared, never the selection state.
keyboard = root('device.keyboard', (-.205, -.235, .008), device_id='keyboard')
box('keyboard.lower', (.397,.150,.016),(0,0,.010),M['black'],.006,keyboard)
box('keyboard.frame', (.397,.150,.012),(0,0,.019),M['silver'],.004,keyboard)
box('keyboard.plate', (.383,.135,.004),(0,0,.027),M['black'],.003,keyboard)
box('keyboard.front.diffuser', (.135,.0013,.0008),(0,-.0753,.017),M['kb_led'],.0003,keyboard)
text('keyboard.mark','OG98',(.167,-.0754,.017),.0032,M['ink'],keyboard,(math.pi/2,0,0))
keymap = json.loads((ROOT/'modules/flesports-og98/assets/layout.json').read_text(encoding='utf-8-sig'))
key_meshes = {}

def cap_mesh(w,h):
    cache_key=(round(w,6),round(h,6))
    if cache_key in key_meshes:return key_meshes[cache_key]
    rings=[(w,h,0),(w,h,.0006),(w-.0025,h-.0027,.0070),(w-.0032,h-.0034,.0076),((w-.0032)*.55,(h-.0034)*.55,.00735)]
    vertices,faces=[],[];segments=32
    for rw,rh,z in rings:
        radius=.0011
        for corner in range(4):
            cx=(rw/2-radius)*(1 if corner in (0,3) else -1)
            cy=(rh/2-radius)*(1 if corner in (0,1) else -1)
            for i in range(8):
                angle=corner*math.pi/2+i/7*math.pi/2
                vertices.append((cx+radius*math.cos(angle),cy+radius*math.sin(angle),z))
    for k in range(len(rings)-1):
        for i in range(segments):faces.append((k*segments+i,k*segments+(i+1)%segments,(k+1)*segments+(i+1)%segments,(k+1)*segments+i))
    center=len(vertices);vertices.append((0,0,.0072))
    for i in range(segments):faces.append(((len(rings)-1)*segments+i,(len(rings)-1)*segments+(i+1)%segments,center))
    faces.append(tuple(range(segments-1,-1,-1)))
    mesh=bpy.data.meshes.new(f'keycap.{w:.4f}.{h:.4f}');mesh.from_pydata(vertices,[],faces);mesh.update()
    for face in mesh.polygons:face.use_smooth=True
    # Split the top lip from the sloped walls: smooth corners must not turn broad
    # PBT faces into inflated pillows under a different runtime lighting rig.
    for edge in mesh.edges:
        if all(3*segments <= v < 4*segments for v in edge.vertices):edge.use_edge_sharp=True
    key_meshes[cache_key]=mesh;return mesh

labels={'Print\nScreen':'PrtSc','Page\nUp':'PgUp','Page\nDown':'PgDn','BackSpace':'Backspace','Caps Lock':'Caps','Num\nLock':'Num','(space)':'','R Shift':'Shift','R Ctrl':'Ctrl','R Alt':'Alt','fn':'Fn'}
for key in keymap:
    unit=.01905/33
    w=(key['w']+7.5)*unit;h=(key['h']+3)*unit
    x=((key['x']-117)+(key['w']+7.5)/2-645/2)*unit
    y=-((key['y']-46)+(key['h']+3)/2-216/2)*unit
    parent=root('key.'+str(key['slot']),(x,y,.028),keyboard,slot_id=key['slot'],key_label=key['label'])
    mesh=cap_mesh(w,h)
    ob=bpy.data.objects.new('keycap.'+str(key['slot']),mesh);scene.collection.objects.link(ob);ob.parent=parent
    ob.data=mesh.copy()  # per-key material slots remain independent while editing selections.
    mod=key['hid']>=224 or key['w']>35 or 'Enter' in key['label']
    ob.data.materials.append(M['mod'] if mod else M['key'])
    text('legend.'+str(key['slot']),labels.get(key['label'],key['label']),(0,0,.00785),.0036 if key['label'] in ['BackSpace','Delete','Insert'] else .0045,M['ink'] if mod else M['legend'],parent)
for x in (-.17,.17):
    for y in (-.055,.055):box('keyboard.foot',(.021,.012,.003),(x,y,0),M['rubber'],.002,keyboard)

# Mouse +Y faces the monitor; -X is the user's thumb side in both scene states.
mouse = root('device.mouse', (.145,-.242,.006), device_id='mouse')
mouse.rotation_euler.z=.08
mouse['front_axis']='+Y';mouse['side_buttons_finish']='white'
profile=[(-.063,.002,.008),(-.060,.014,.016),(-.053,.025,.027),(-.037,.031,.0355),(-.018,.03175,.038),(.002,.0307,.0365),(.018,.0298,.0315),(.039,.0295,.0250),(.055,.0290,.0210),(.062,.0270,.0190)]
def mouse_height(y):
    for a,b in zip(profile,profile[1:]):
        if a[0]<=y<=b[0]:return .002+a[2]+(b[2]-a[2])*(y-a[0])/(b[0]-a[0])
    return .002+profile[-1][2]
vertices,faces=[],[];sections=28
for y,w,h in profile:
    for i in range(sections+1):
        angle=math.pi*i/sections
        vertices.append((w*math.cos(angle),y,.002+h*math.sin(angle)**.72))
for row in range(len(profile)-1):
    for i in range(sections):a=row*(sections+1)+i;faces.append((a,a+sections+1,a+sections+2,a+1))
faces.append(tuple(range(sections+1)));last=(len(profile)-1)*(sections+1);faces.append(tuple(last+i for i in range(sections,-1,-1)))
mesh=bpy.data.meshes.new('mouse.shell');mesh.from_pydata(vertices,[],faces);mesh.update()
ob=bpy.data.objects.new('mouse.shell',mesh);scene.collection.objects.link(ob);ob.parent=mouse;mesh.materials.append(M['ivory'])
for face in mesh.polygons:face.use_smooth=True
sub=ob.modifiers.new('Continuous shell curvature','SUBSURF');sub.levels=2;sub.render_levels=2
shell=ob
outline=[(w*.98,y) for y,w,h in profile]+[(-w*.98,y) for y,w,h in reversed(profile)]
count=len(outline);vertices=[(x,y,z) for z in (.001,.003) for x,y in outline]
faces=[tuple(range(count-1,-1,-1)),tuple(range(count,count*2))]
faces.extend((i,(i+1)%count,(i+1)%count+count,i+count) for i in range(count))
mesh=bpy.data.meshes.new('mouse.base');mesh.from_pydata(vertices,[],faces);mesh.update()
base=bpy.data.objects.new('mouse.base',mesh);scene.collection.objects.link(base);base.parent=mouse;mesh.materials.append(M['black'])
bevel=base.modifiers.new('Base edge','BEVEL');bevel.width=.00065;bevel.segments=4
split=line('mouse.button.split',[(0,y,mouse_height(y)+.0006) for y in (.009,.018,.039,.052,.058)],.00014,M['ink'],mouse)
seam=line('mouse.button.seam',[(x,.008,mouse_height(.008)*max(0,1-(x/.0305)**2)**.36+.0006) for x in (-.029,-.026,-.020,-.01,0,.01,.020,.026,.029)],.00013,M['ink'],mouse)
for detail in (split,seam):
    shrink=detail.modifiers.new('Follow shell contour','SHRINKWRAP');shrink.target=shell;shrink.wrap_method='PROJECT';shrink.use_project_z=True;shrink.use_negative_direction=True;shrink.use_positive_direction=False;shrink.offset=.00006
wheel_y,wheel_z=.034,.0265
box('mouse.wheel.recess',(.008,.020,.002),(0,wheel_y,.028),M['ink'],.001,mouse)
cylinder('mouse.wheel',.0077,.0052,(0,wheel_y,wheel_z),M['rubber'],'X',mouse,64)
for n in range(32):
    angle=n/32*math.tau
    grip=box('mouse.wheel.grip',(.0052,.00065,.00055),(0,wheel_y+math.sin(angle)*.0077,wheel_z+math.cos(angle)*.0077),M['rubber'],.0002,mouse)
    grip.rotation_euler.x=-angle
for index,y in enumerate((.002,.022)):
    box('mouse.side.button.recess',(.0005,.0168,.0042),(-.0284,y,.0243),M['ink'],.0002,mouse)
    button=box(f'mouse.side.button.{index}',(.0034,.016,.0038),(-.029,y,.0243),M['ivory'],.0012,mouse)
    button.rotation_euler.y=.18
box('mouse.usb.port',(.009,.002,.0034),(0,.0616,.010),M['black'],.0012,mouse)
mark=text('mouse.mark','G',(0,-.030,mouse_height(-.030)+.0006),.010,M['steel'],mouse)
shrink=mark.modifiers.new('Printed on shell','SHRINKWRAP');shrink.target=shell;shrink.wrap_method='PROJECT';shrink.use_project_z=True;shrink.use_negative_direction=True;shrink.use_positive_direction=False;shrink.offset=.00005

def fan(name,loc,parent,axis='Z',lit=False):
    frame=root(name,loc,parent)
    frame.rotation_euler={'X':(0,math.pi/2,0),'Y':(math.pi/2,0,0),'Z':(0,0,0)}[axis]
    for x,y,sx,sy in ((-.062,0,.008,.132),(.062,0,.008,.132),(0,-.062,.116,.008),(0,.062,.116,.008)):
        box(name+'.frame',(sx,sy,.022),(x,y,0),M['black'],.002,frame)
    ring(name+'.outer',.055,.003,(0,0,-.001),M['shell'],parent=frame)
    if lit:ring(name+'.diffuser',.056,.0010,(0,0,.010),M['pc_led'],parent=frame)
    rotor=root(name+'.rotor',(0,0,0),frame,animation_role='fan')
    cylinder(name+'.hub',.016,.012,(0,0,.004),M['black'],parent=rotor,vertices=32)
    for i in range(7):
        points=[(.012,-.004,0),(.023,-.025,.001),(.044,-.031,.003),(.052,-.013,.003),(.046,.003,.001),(.025,.009,0)]
        angle=i/7*math.tau
        vertices=[(x*math.cos(angle)-y*math.sin(angle),x*math.sin(angle)+y*math.cos(angle),z) for x,y,z in points]
        mesh=bpy.data.meshes.new(name+'.blade');mesh.from_pydata(vertices,[],[tuple(range(6))]);mesh.update()
        ob=bpy.data.objects.new(name+'.blade',mesh);scene.collection.objects.link(ob);ob.parent=rotor;mesh.materials.append(M['shell'])
        solid=ob.modifiers.new('Blade thickness','SOLIDIFY');solid.thickness=.001
        bevel=ob.modifiers.new('Blade edge','BEVEL');bevel.width=.001;bevel.segments=3
    for x in (-.055,.055):
        for y in (-.055,.055):screw(name+'.screw',(x,y,.012),frame,radius=.002)
    return frame

computer=root('device.computer',(.62,.145,.008),device_id='computer')
computer.rotation_euler.z=.54
W,D,H=.235,.435,.465
box('case.bottom',(W,D,.012),(0,0,.012),M['shell'],.004,computer)
box('case.right.panel',(.005,D,H),(.116,0,H/2),M['shell'],.003,computer)
for x in (-.113,.113):
    for y in (-.211,.211):box('case.corner',(.009,.009,H),(x,y,H/2),M['steel'],.002,computer)
for z in (.025,H-.006):
    for x in (-.115,.115):box('case.side.rail',(.009,D,.011),(x,0,z),M['shell'],.002,computer)
for y in (-.213,.213):box('case.top.crossrail',(W,.014,.012),(0,y,H-.006),M['shell'],.002,computer)
for x in (-.10,.10):box('case.top.shoulder',(.035,D,.009),(x,0,H-.003),M['shell'],.003,computer)
for i in range(40):box('case.top.vent',(.17,.006,.003),(0,-.195+i*.010,H-.002),M['black'],.001,computer)
for x in (-.08,.08):
    for y in (-.17,.17):box('case.foot',(.035,.035,.012),(x,y,-.001),M['rubber'],.003,computer)
for z in (.092,.227,.362):fan('case.front.fan',(0,-.200,z),computer,'Y',lit=True)
for x in (-.105,.105):box('case.front.shoulder',(.025,.014,.435),(x,-.213,.236),M['shell'],.004,computer)
for i in range(26):box('case.front.mesh',(.004,.002,.424),(-.09+i*.0072,-.218,.236),M['black'],.0006,computer)
box('case.front.lower',(W,.012,.035),(0,-.214,.019),M['shell'],.003,computer)
text('case.wordmark','DESKHUB',(0,-.222,.022),.005,M['steel'],computer,(math.pi/2,0,0))
box('case.power.button',(.015,.015,.003),(.070,-.17,H+.001),M['black'],.004,computer)
for x in (.025,.048):box('case.usb.port',(.013,.005,.001),(x,-.17,H+.002),M['black'],.001,computer)

motherboard=root('component.motherboard',parent=computer,part_id='motherboard')
box('motherboard.pcb',(.003,.286,.305),(.087,.038,.280),M['pcb'],.002,motherboard)
for y,z,sy,sz in ((.15,.32,.035,.13),(.045,.40,.16,.025),(-.035,.265,.11,.025)):
    box('motherboard.heatsink',(.022,sy,sz),(.074,y,z),M['steel'],.002,motherboard)
for j in range(11):box('motherboard.vrm.fins',(.014,.0012,.12),(.058,.135+j*.003,.32),M['black'],.0003,motherboard)
for y in (-.09,.16):
    for z in (.14,.42):screw('motherboard.mount',(.084,y,z),motherboard,'X')
# Repeated real-sized board components and traces give the board readable depth
# without drawing decorative UI marks over the physical assembly.
for i in range(8):
    y=-.074+i*.029
    box('motherboard.controller',(.004,.012,.009),(.082,y,.281),M['black'],.0005,motherboard)
    for j in range(3):box('motherboard.resistor',(.002,.0025,.0012),(.079,y+j*.003,.294),M['steel'],.00015,motherboard)
for i in range(6):
    line('motherboard.trace',[(.085,-.09+i*.025,.22),(.085,-.09+i*.025,.24),(.085,-.08+i*.025,.25)],.00018,M['steel'],motherboard,smooth=False)
cpu=root('component.cpu',parent=computer,part_id='cpu')
box('cpu.socket',(.007,.055,.055),(.076,.064,.331),M['black'],.002,cpu)
cylinder('cpu.pump',.033,.024,(.046,.064,.331),M['shell'],'X',cpu)
cylinder('cpu.face',.029,.002,(.032,.064,.331),M['steel'],'X',cpu)
ring('cpu.light',.027,.0007,(.030,.064,.331),M['pc_led'],'X',cpu)
text('cpu.label','RYZEN',(.029,.064,.334),.007,M['legend'],cpu,(math.pi/2,0,-math.pi/2))
for dy in (-.008,.008):
    line('cpu.coolant.tube',[(.045,.045+dy,.35),(-.004,.022+dy,.39),(-.014,-.04+dy,.432),(.025,-.095+dy,.445)],.004,M['rubber'],cpu)
fan('case.radiator.fan.1',(.013,-.085,.442),computer,'Z')
fan('case.radiator.fan.2',(.013,.065,.442),computer,'Z')
memory=root('component.memory',parent=computer,part_id='memory')
for y in (-.038,-.058):
    box('memory.module',(.017,.008,.126),(.063,y,.326),M['black'],.001,memory)
    box('memory.heatspreader',(.020,.009,.112),(.054,y,.33),M['steel'],.001,memory)
    box('memory.light',(.003,.010,.100),(.042,y,.333),M['pc_led'],.001,memory)
gpu=root('component.gpu',parent=computer,part_id='gpu')
box('gpu.body',(.172,.315,.055),(-.002,.034,.181),M['shell'],.004,gpu)
box('gpu.backplate',(.174,.315,.002),(-.002,.034,.210),M['steel'],.001,gpu)
for j in range(18):box('gpu.fins',(.172,.0017,.037),(-.002,-.105+j*.016,.179),M['black'],.0005,gpu)
box('gpu.side.trim',(.002,.23,.012),(-.090,.03,.19),M['silver'],.001,gpu)
box('gpu.light',(.002,.063,.0015),(-.091,-.057,.194),M['pc_led'],.0004,gpu)
text('gpu.label','RTX 5080',(-.092,.047,.190),.007,M['ink'],gpu,(math.pi/2,0,-math.pi/2))
for y in (-.08,.025,.13):
    cylinder('gpu.fan',.043,.003,(-.002,y,.152),M['black'],parent=gpu,vertices=48)
    ring('gpu.fan.rim',.041,.001,(-.002,y,.149),M['steel'],parent=gpu)
for y in (-.105,.175):
    for x in (-.071,.067):screw('gpu.backplate.screw',(x,y,.212),gpu)
for i in range(6):
    line('gpu.power.cable',[(-.076,.105+i*.004,.18),(-.097,.105+i*.004,.145),(-.081,.11+i*.004,.092),(.035,.12+i*.004,.06)],.0018,M['rubber'],computer)
storage=root('component.storage',parent=computer,part_id='storage')
box('storage.m2.heatsink',(.010,.092,.021),(.075,.035,.245),M['steel'],.001,storage)
for z in (.238,.244,.250):box('storage.m2.fin',(.002,.080,.001),(.068,.035,z),M['black'],.0002,storage)
text('storage.label','M.2',(.068,.035,.246),.004,M['legend'],storage,(math.pi/2,0,-math.pi/2))
network=root('component.network',parent=computer,part_id='network')
box('network.io.shield',(.026,.024,.13),(.064,.186,.315),M['black'],.002,network)
for z in (.275,.30,.325,.35):box('network.io.port',(.014,.003,.008),(.052,.200,z),M['steel'],.001,network)
box('network.controller',(.014,.038,.024),(.064,.166,.239),M['steel'],.002,network)
text('network.label','LAN',(.055,.166,.240),.0045,M['legend'],network,(math.pi/2,0,-math.pi/2))
box('case.psu.shroud',(.213,.411,.091),(0,0,.070),M['shell'],.003,computer)
for i in range(24):box('case.psu.vent',(.002,.07,.001),(-.09+i*.0075,.095,.116),M['black'],.0003,computer)
fan('case.rear.exhaust',(.018,.197,.353),computer,'Y')
door=root('case.side_panel.hinge',(-.122,.208,.244),computer,animation_role='side_panel')
box('case.glass',(.002,.411,.424),(0,-.2055,0),M['glass'],.001,door)
for y in (0,-.411):box('case.glass.vertical_edge',(.005,.005,.43),(0,y,0),M['steel'],.001,door)
for z in (-.214,.214):box('case.glass.horizontal_edge',(.005,.411,.005),(0,-.2055,z),M['steel'],.001,door)
for z in (-.15,.15):cylinder('case.hinge',.004,.022,(0,0,z),M['steel'],parent=door,vertices=24)

def light(name,loc,target,power,color,size,size_y=None):
    data=bpy.data.lights.new(name,'AREA');data.energy=power;data.color=linear(color)[:3]
    data.shape='RECTANGLE';data.size=size;data.size_y=size_y or size
    ob=bpy.data.objects.new(name,data);scene.collection.objects.link(ob);ob.location=loc
    ob.rotation_euler=(Vector(target)-ob.location).to_track_quat('-Z','Y').to_euler();return ob

light('softbox.key',(-.85,-.65,1.75),(0,0,.12),150,'E5EEF1',1.35,.8)
light('softbox.fill',(.8,-1.0,.85),(0,0,.2),65,'FFF1DC',1.0,.65)
light('softbox.rim',(.35,.60,1.15),(.2,0,.25),110,'A9D5DE',.85,.35)
internal=bpy.data.lights.new('case.internal','POINT');internal.energy=.75;internal.color=(.8,.93,1);internal.shadow_soft_size=.035;internal.specular_factor=0;internal.transmission_factor=0
ob=bpy.data.objects.new('case.internal',internal);scene.collection.objects.link(ob);ob.location=(.60,.12,.39)
ob.visible_camera=False;ob.visible_glossy=False;ob.visible_transmission=False
light('wall.wash',(-.2,.48,.18),(-.2,.67,.34),6,'73C8D5',.62,.03)
camera_data=bpy.data.cameras.new('camera.home');camera_data.type='PERSP';camera_data.lens=44
camera=bpy.data.objects.new('camera.home',camera_data);scene.collection.objects.link(camera)
camera.location=(-.50,-1.85,.87);target=Vector((.03,.04,.20));camera.rotation_euler=(target-camera.location).to_track_quat('-Z','Y').to_euler();scene.camera=camera
root('camera.target',target)
scene.render.filepath=str(OUT/'studio-overview.png')
scene['visual_revision']='studio-v1'
scene['keyboard_source']='modules/flesports-og98/assets/layout.json'
scene['keyboard_key_count']=len(keymap)

# Keep a source scene before converting font/curve primitives for exchange.
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'deskhub-studio.blend'))
if opt.render:bpy.ops.render.render(write_still=True)
for ob in list(scene.objects):
    if ob.type in {'FONT','CURVE'}:
        bpy.ops.object.select_all(action='DESELECT');ob.select_set(True);bpy.context.view_layer.objects.active=ob
        bpy.ops.object.convert(target='MESH')
bpy.ops.object.select_all(action='SELECT')
bpy.ops.export_scene.gltf(filepath=str(OUT/'deskhub-studio.glb'),export_format='GLB',export_apply=True,export_cameras=True,export_lights=False,export_extras=True,export_animations=False)
manifest={'blender':bpy.app.version_string,'revision':'studio-v1','keyCount':len(keymap),'objects':len(scene.objects),'camera':{'position':list(camera.location),'target':list(target),'type':'perspective','lens':camera_data.lens},'source':'design/studio/build_scene.py','modelBytes':(OUT/'deskhub-studio.glb').stat().st_size}
(OUT/'scene-manifest.json').write_text(json.dumps(manifest,indent=2),encoding='utf-8')
print('DESKHUB_SCENE='+json.dumps(manifest))
