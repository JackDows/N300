"""Mouse surface patches in metres: separate buttons, shell, base and controls.

+Y points towards the screen; -X is the thumb side. The 125 × 63.5 × 40 mm
envelope is retained in both desk and focused poses. Seams are gaps between
surfaces, rather than dark strokes on a single uninterrupted shell.
"""
import math
import bpy


# Half-widths from the official top view's unobstructed right silhouette,
# normalized to 63.5 × 125 mm. The side view constrains the palm height.
PROFILE = (
    (-.0625, .0001, .0050), (-.061875, .00651, .0060),
    (-.0600, .01230, .0101), (-.05625, .01865, .0158),
    (-.0500, .02500, .0224), (-.03750, .03072, .0303),
    (-.0250, .03175, .0346), (-.01250, .03080, .0370),
    ( .0000, .02992, .0376), ( .01250, .03040, .0363),
    ( .0250, .03072, .0329), ( .03750, .03088, .0263),
    ( .04375, .03024, .0233), ( .05000, .02746, .0205),
    ( .05625, .02119, .0165), ( .06000, .01326, .0140),
    ( .061875, .00651, .0127), ( .0625, .0001, .0120),
)


def profile(y):
    """Cubic Hermite interpolation avoids faceting along the palm curve."""
    for i in range(len(PROFILE)-1):
        a, b = PROFILE[i:i+2]
        if y <= b[0]:
            before, after = PROFILE[max(0, i-1)], PROFILE[min(len(PROFILE)-1, i+2)]
            t = max(0, (y-a[0])/(b[0]-a[0]))
            h00, h10 = 2*t**3-3*t*t+1, t**3-2*t*t+t
            h01, h11 = -2*t**3+3*t*t, t**3-t*t
            values = tuple(
                h00*a[c] + h10*(b[0]-a[0])*(b[c]-before[c])/(b[0]-before[0])
                + h01*b[c] + h11*(b[0]-a[0])*(after[c]-a[c])/(after[0]-a[0])
                for c in (1, 2)
            )
            tip_distance = min(y+.0625, .0625-y)
            if tip_distance < .000625:
                values = (max(.000001, .00651*math.sqrt(max(0, tip_distance)/.000625)), values[1])
            return values
    return PROFILE[-1][1:]


def surface(y, angle):
    width, height = profile(y)
    # The side walls stay almost vertical below the palm curve. An ellipse
    # narrows too early and makes side buttons appear to sit on the roof.
    cosine = math.cos(angle)
    lower = 1-max(0, math.sin(angle))**.72
    front = max(0, min(1, (y-.035)/.0275))
    rear = max(0, min(1, (-y-.048)/.0145))
    inset_y = y-.010*front*front*(3-2*front)*lower+.002*rear*rear*(3-2*rear)*lower
    return (width*math.copysign(abs(cosine)**.38, cosine), inset_y,
            .002 + height*max(0, math.sin(angle))**.72)


def seam_y(angle):
    return .006 + .0015*abs(math.cos(angle))**1.8


def front_y(angle):
    return .06245


def build_mouse(M, root, box, cylinder, text):
    mouse = root('device.mouse', (.145, -.222, .006), device_id='mouse')
    mouse.rotation_euler.z = .045
    mouse['front_axis'] = '+Y'
    mouse['side_buttons_finish'] = 'white'
    mouse['dimensions_mm'] = [125, 63.5, 40]

    def mesh_object(name, patches, material, solid=False):
        vertices, faces = [], []
        for samples_u, samples_v, position in patches:
            start = len(vertices)
            for j in range(samples_v+1):
                for i in range(samples_u+1):
                    vertices.append(position(i/samples_u, j/samples_v))
            for j in range(samples_v):
                for i in range(samples_u):
                    a = start+j*(samples_u+1)+i
                    faces.append((a, a+samples_u+1, a+samples_u+2, a+1))
        mesh = bpy.data.meshes.new(name)
        mesh.from_pydata(vertices, [], faces)
        mesh.update()
        ob = bpy.data.objects.new(name, mesh)
        bpy.context.scene.collection.objects.link(ob)
        ob.parent = mouse
        mesh.materials.append(material)
        for face in mesh.polygons:
            face.use_smooth = True
        if solid:
            wall = ob.modifiers.new('Moulded shell thickness', 'SOLIDIFY')
            wall.thickness = .00065
            wall.offset = -1
            bevel = ob.modifiers.new('Fine parting edge', 'BEVEL')
            bevel.width = .00016
            bevel.segments = 3
            bevel.limit_method = 'ANGLE'
        return ob

    def rear(u, v):
        v = (1-math.cos(v*math.pi))/2
        angle = u*math.pi
        y = -.0625 + v*(seam_y(angle)-.00028+.0625)
        return surface(y, angle)

    def side(u, v, left):
        angle = .800*u
        if left:
            angle = math.pi-angle
        y = seam_y(angle)-.00028+v*(front_y(angle)-seam_y(angle)+.00028)
        return surface(y, angle)

    shell = mesh_object('mouse.shell', [
        (72, 64, rear),
        (14, 48, lambda u, v: side(u, v, False)),
        (14, 48, lambda u, v: side(1-u, v, True)),
    ], M['ivory'], solid=True)

    def button(u, v, left):
        v = (1-math.cos(v*math.pi))/2
        # The wheel opening widens only where the rubber wheel passes through.
        y0 = .0064 + v*.05605
        width, _ = profile(y0)
        wheel_cut = .0035*math.exp(-((y0-.034)/.0100)**10)
        middle = math.acos(min(.9999, ((.00030+wheel_cut)/max(width,.001))**(1/.38)))
        angle = .820+u*(max(.822,middle)-.820)
        if left:
            angle = math.pi-angle
        y = seam_y(angle)+.00032+v*(front_y(angle)-seam_y(angle)-.00032)
        return surface(y, angle)

    mesh_object('mouse.button.right', [(36, 64, lambda u, v: button(u, v, False))], M['ivory'], True)
    mesh_object('mouse.button.left', [(36, 64, lambda u, v: button(1-u, v, True))], M['ivory'], True)

    # The lower chassis has a different finish and meets the shell at a fine lip.
    outline = []
    for sign, steps in ((1, range(97)), (-1, range(96, -1, -1))):
        for i in steps:
            y = -.06249+(1-math.cos(i/96*math.pi))/2*.12494
            x, actual_y, _ = surface(y, 0)
            outline.append((sign*max(.00001,x-.00035), actual_y))
    n = len(outline)
    vertices = [(x, y, z) for z in (.0007, .0027) for x, y in outline]
    faces = [tuple(range(n-1, -1, -1)), tuple(range(n, 2*n))]
    faces.extend((i, (i+1)%n, (i+1)%n+n, i+n) for i in range(n))
    mesh = bpy.data.meshes.new('mouse.base')
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    base = bpy.data.objects.new('mouse.base', mesh)
    bpy.context.scene.collection.objects.link(base)
    base.parent = mouse
    mesh.materials.append(M['black'])
    bevel = base.modifiers.new('Lower chassis lip', 'BEVEL')
    bevel.width = .00038
    bevel.segments = 3

    # The rounded front terminates at the nose, rather than a rectangular cap.
    def nose(u, v):
        angle = math.pi*u
        x, y, z = surface(front_y(angle), angle)
        return (x, .0525+v*(y-.0525)-.0005, .002+v*(z-.002))
    mesh_object('mouse.front.wall', [(72, 8, lambda u, v: nose(1-u, v))], M['ivory'])
    box('mouse.wheel.recess', (.0094, .022, .002), (0, .034, .020), M['black'], .001, mouse)
    def tread(u,v):
        angle=u*math.tau
        radius=.00755+.00015*(.5+.5*math.cos(angle*96))**3
        return ((v-.5)*.0052,.034+radius*math.sin(angle),.0263+radius*math.cos(angle))
    mesh_object('mouse.wheel',[(768,2,tread)],M['rubber'])
    for x in (-.00275, .00275):
        cylinder('mouse.wheel.rim', .00725, .00045, (x, .034, .0263), M['ivory'], 'X', mouse, 64)

    # Both caps share a side plane. Their planforms follow the side reference:
    # the forward cap rises gently towards the palm; the rear cap has a rounded
    # trailing end. Neither is projected or sheared across the body surface.
    control_outlines = (
        [(.0028,.0254),(-.0119,.0252),(-.0143,.0248),(-.0151,.0236),
         (-.0150,.0217),(-.0141,.0206),(-.0127,.0203),(.0007,.0208)],
        [(.0237,.0202),(.0236,.0212),(.0227,.0220),(.0208,.0227),
         (.0060,.0250),(.0035,.0209),(.0209,.0186),(.0228,.0187),(.0236,.0193)],
    )
    for index, outline in enumerate(control_outlines):
        center_y = sum(p[0] for p in outline)/len(outline)
        center_z = sum(p[1] for p in outline)/len(outline)
        for is_recess in (True, False):
            expansion = 1.10 if is_recess else 1
            points=[(center_y+(y-center_y)*expansion,center_z+(z-center_z)*expansion) for y,z in outline]
            x0,x1 = (-.0297,-.0291) if is_recess else (-.03055,-.0290)
            vertices=[(x,y,z) for x in (x0,x1) for y,z in points]
            n=len(points)
            faces=[tuple(range(n-1,-1,-1)),tuple(range(n,2*n))]
            faces.extend((i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n))
            name=f'mouse.side.{"recess" if is_recess else "button"}.{index}'
            mesh=bpy.data.meshes.new(name);mesh.from_pydata(vertices,[],faces);mesh.update()
            ob=bpy.data.objects.new(name,mesh);bpy.context.scene.collection.objects.link(ob);ob.parent=mouse
            mesh.materials.append(M['black'] if is_recess else M['ivory'])
            bevel=ob.modifiers.new('Button edge radius','BEVEL');bevel.width=.00025 if is_recess else .00055;bevel.segments=5;bevel.harden_normals=True
            normal=ob.modifiers.new('Continuous face normal','WEIGHTED_NORMAL');normal.keep_sharp=True

    def tail(u, v):
        x, y, z = surface(-.0625, math.pi*u)
        return (x, -.0605+v*(y+.0605), .002+v*(z-.002))
    mesh_object('mouse.tail.cap', [(48, 6, tail)], M['ivory'])

    logo_vertices, logo_faces = [], []
    for i in range(49):
        angle = math.pi/2+i/48*math.pi
        for radius in (.0054,.00325):
            logo_vertices.append((radius*math.cos(angle),radius*math.sin(angle),0))
    for i in range(48):
        logo_faces.append((2*i,2*i+2,2*i+3,2*i+1))
    start=len(logo_vertices)
    logo_vertices.extend((x,y,0) for x,y in ((0,.0009),(.0048,.0009),(.0048,-.0044),(.0026,-.0044),(.0026,-.0014),(0,-.0014)))
    logo_faces.append(tuple(start+i for i in reversed(range(6))))
    logo_mesh=bpy.data.meshes.new('mouse.mark')
    logo_mesh.from_pydata(logo_vertices,[],logo_faces);logo_mesh.update()
    mark=bpy.data.objects.new('mouse.mark',logo_mesh)
    bpy.context.scene.collection.objects.link(mark)
    mark.parent=mouse;mark.location=(0,-.031,.043)
    logo_mesh.materials.append(M['steel'])
    mark.modifiers.new('Ink triangles','TRIANGULATE')
    subdivision=mark.modifiers.new('Ink surface samples','SUBSURF')
    subdivision.subdivision_type='SIMPLE';subdivision.levels=3;subdivision.render_levels=3
    wrap = mark.modifiers.new('Printed on palm shell', 'SHRINKWRAP')
    wrap.target = shell
    wrap.wrap_method = 'PROJECT'
    wrap.wrap_mode = 'ABOVE_SURFACE'
    wrap.use_project_z = True
    wrap.use_negative_direction = True
    wrap.use_positive_direction = False
    wrap.offset = .00005
    return mouse
