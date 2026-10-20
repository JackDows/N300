"""OG98 display asset: actual slot layout, sculpted caps and a separated enclosure."""
import math
import bpy


def rounded_outline(width, depth, radius, segments=10):
    points = []
    for corner in range(4):
        cx = (width / 2 - radius) * (1 if corner in (0, 3) else -1)
        cy = (depth / 2 - radius) * (1 if corner in (0, 1) else -1)
        for i in range(segments):
            angle = (corner + i / (segments - 1)) * math.pi / 2
            points.append((cx + radius * math.cos(angle), cy + radius * math.sin(angle)))
    return points


def build_keyboard(keymap, materials, root, box, text):
    keyboard = root('device.keyboard', (-.175, -.255, .005), device_id='keyboard')
    m = materials
    box('keyboard.lower.tray', (.400, .154, .016), (0, 0, .012), m['shell'], .0055, keyboard)
    box('keyboard.enclosure.seam', (.397, .151, .0010), (0, 0, .0190), m['black'], .0004, keyboard)

    # A genuine open bezel. The plate below is visible between the keys, rather
    # than a solid silver slab intersecting the caps.
    rings = [
        (.398, .152, .0048, .0197),
        (.398, .152, .0048, .0232),
        (.396, .150, .0042, .0245),
        (.3954, .1494, .0040, .0246),
        (.3826, .1356, .0023, .0246),
        (.382, .135, .0020, .0245),
        (.380, .133, .0015, .0227),
    ]
    vertices, faces = [], []
    count = 40
    for width, depth, radius, z in rings:
        vertices.extend((x, y, z + y * .025) for x, y in rounded_outline(width, depth, radius))
    for k in range(len(rings) - 1):
        for i in range(count):
            faces.append((k * count + i, k * count + (i + 1) % count,
                          (k + 1) * count + (i + 1) % count, (k + 1) * count + i))
    mesh = bpy.data.meshes.new('keyboard.open.bezel')
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    for face in mesh.polygons:
        face.use_smooth = True
    bezel = bpy.data.objects.new('keyboard.open.bezel', mesh)
    bpy.context.scene.collection.objects.link(bezel)
    bezel.parent = keyboard
    mesh.materials.append(m['bezel'])
    normals = bezel.modifiers.new('Planar bezel highlights', 'WEIGHTED_NORMAL')
    normals.keep_sharp = True
    box('keyboard.switch.plate', (.381, .134, .002), (0, 0, .0225), m['plate'], .0012, keyboard)
    box('keyboard.front.light.recess', (.105, .0015, .0015), (-.026, -.0765, .014), m['black'], .0005, keyboard)
    light = box('keyboard.front.diffuser', (.100, .0010, .0006), (-.026, -.0771, .014), m['kb_led'], .0002, keyboard)
    light['light_role'] = 'keyboard'
    text('keyboard.front.brand', 'OG98', (.157, -.0771, .014), .003, m['legend'], keyboard, (math.pi / 2, 0, 0))
    text('keyboard.top.brand', 'OG98', (.166, -.0707, .0232), .0027, m['ink'], keyboard)
    # Rear port and foot assemblies are real geometry and stay with the device.
    box('keyboard.usb.recess', (.012, .0015, .004), (-.136, .077, .012), m['black'], .0012, keyboard)
    box('keyboard.usb.tongue', (.008, .0016, .0011), (-.136, .0778, .012), m['steel'], .0004, keyboard)
    for x in (-.171, .171):
        for y in (-.055, .055):
            box('keyboard.rubber.foot', (.024, .012, .003), (x, y, .002), m['rubber'], .0013, keyboard)

    cache = {}
    profiles = {
        46: (.0108, -.080), 92: (.0102, -.055), 125: (.0090, -.015),
        158: (.0086, .025), 191: (.0094, .070), 224: (.0102, .105),
    }

    def cap_mesh(width, depth, height, tilt, space=False):
        identity = (round(width, 6), round(depth, 6), height, tilt, space)
        if identity in cache:
            return cache[identity]
        vertices, faces = [], []
        top_w, top_d = width - .0028, depth - .0031

        def surface(x, y):
            dish = .00085 * max(0, 1 - (y / (top_d / 2)) ** 2)
            return height + y * math.tan(tilt) + (dish * .35 if space else -dish)

        # A Cartesian top grid follows the cylindrical dish. Radial n-gon fans
        # make diagonal facets visible across the wide, almost planar key tops.
        nx, ny = max(24, round(top_w / .0007)), max(24, round(top_d / .0007))

        def corner(x, y, w, d, radius):
            cx, cy = w / 2 - radius, d / 2 - radius
            ax, ay = abs(x), abs(y)
            if ax > cx and ay > cy:
                dx, dy = ax - cx, ay - cy
                length = math.hypot(dx, dy)
                if length > radius:
                    x = math.copysign(cx + dx / length * radius, x)
                    y = math.copysign(cy + dy / length * radius, y)
            return x, y

        for j in range(ny + 1):
            for i in range(nx + 1):
                x, y = corner((i / nx - .5) * top_w, (j / ny - .5) * top_d, top_w, top_d, .0010)
                vertices.append((x, y, surface(x, y)))
        for j in range(ny):
            for i in range(nx):
                index = j * (nx + 1) + i
                faces.append((index, index + 1, index + nx + 2, index + nx + 1))
        boundary = ([(i, 0) for i in range(nx + 1)] +
                    [(nx, j) for j in range(1, ny + 1)] +
                    [(i, ny) for i in range(nx - 1, -1, -1)] +
                    [(0, j) for j in range(ny - 1, 0, -1)])
        perimeter = len(boundary)
        top_indices = [j * (nx + 1) + i for i, j in boundary]
        # Closely spaced support rings give the lip and skirt independent curves.
        sections = [
            (width - .0004, depth - .0004, .0000),
            (width, depth, .00045),
            (width - .0001, depth - .0001, .0011),
            (top_w + .0009, top_d + .0010, height - .0010),
            (top_w + .0005, top_d + .0005, height - .0003),
        ]
        skirt_start = len(vertices)
        for w, d, z in sections:
            for i, j in boundary:
                x, y = corner((i / nx - .5) * w, (j / ny - .5) * d, w, d, .00105)
                vertices.append((x, y, z + y * math.tan(tilt)))
        for k in range(len(sections) - 1):
            start = skirt_start + k * perimeter
            for i in range(perimeter):
                next_i = (i + 1) % perimeter
                faces.append((start + i, start + next_i, start + perimeter + next_i, start + perimeter + i))
        last = skirt_start + (len(sections) - 1) * perimeter
        for i in range(perimeter):
            next_i = (i + 1) % perimeter
            faces.append((last + i, last + next_i, top_indices[next_i], top_indices[i]))
        faces.append(tuple(skirt_start + i for i in range(perimeter - 1, -1, -1)))
        mesh = bpy.data.meshes.new('keycap.sculpted')
        mesh.from_pydata(vertices, [], faces)
        mesh.update()
        for polygon in mesh.polygons:
            polygon.use_smooth = True
        cache[identity] = (mesh, surface)
        return mesh, surface

    labels = {'Print\nScreen': 'PrtSc', 'Page\nUp': 'PgUp', 'Page\nDown': 'PgDn',
              'BackSpace': 'Backspace', 'Caps Lock': 'Caps', 'Num\nLock': 'Num',
              '(space)': '', 'R Shift': 'Shift', 'R Ctrl': 'Ctrl', 'R Alt': 'Alt', 'fn': 'Fn'}
    shifted = {'1': '!', '2': '@', '3': '#', '4': '$', '5': '%', '6': '^', '7': '&', '8': '*',
               '9': '(', '0': ')', '-': '_', '=': '+', '[': '{', ']': '}', ';': ':', "'": '"',
               ',': '<', '.': '>', '/': '?', '\\': '|', '`': '~'}
    for key in keymap:
        unit = .01905 / 33
        width, depth = (key['w'] + 7.5) * unit, (key['h'] + 3) * unit
        x = (key['x'] - 117 + (key['w'] + 7.5) / 2 - 645 / 2) * unit
        y = -(key['y'] - 46 + (key['h'] + 3) / 2 - 216 / 2) * unit
        row = min(profiles, key=lambda r: abs(r - key['y']))
        height, tilt = profiles[row]
        parent = root(f'key.{key["slot"]}', (x, y, .0245 + y * .025), keyboard,
                      slot_id=key['slot'], key_label=key['label'], key_row=row)
        mesh, surface = cap_mesh(width, depth, height, tilt, key['label'] == '(space)')
        cap = bpy.data.objects.new(f'keycap.{key["slot"]}', mesh.copy())
        bpy.context.scene.collection.objects.link(cap)
        cap.parent = parent
        modifier = key['hid'] >= 224 or key['w'] > 35 or 'Enter' in key['label']
        cap.data.materials.append(m['mod'] if modifier else m['key'])
        label = labels.get(key['label'], key['label'])
        ink = m['ink'] if modifier else m['legend']
        has_shift = label in shifted and x < .09
        legend_y = (-.0023 if has_shift else .0007) if depth < .025 else depth * .23
        legend = text(f'legend.{key["slot"]}', label, (0, legend_y, surface(0, legend_y) + .000045),
                      .0040 if len(label) > 4 else .0045 if len(label) > 1 or has_shift else .0050, ink, parent, (tilt, 0, 0))
        legend.data.extrude = 0
        if has_shift:
            secondary_y = .0032
            secondary = text(f'legend.secondary.{key["slot"]}', shifted[label],
                             (0, secondary_y, surface(0, secondary_y) + .00005), .0026, ink, parent, (tilt, 0, 0))
            secondary.data.extrude = 0
        for printing in [child for child in parent.children if child.name.startswith('legend.')]:
            stamp = printing.modifiers.new('Ink follows dished cap', 'SHRINKWRAP')
            stamp.target = cap
            stamp.wrap_method = 'PROJECT'
            stamp.wrap_mode = 'ABOVE_SURFACE'
            stamp.use_project_z = True
            stamp.use_negative_direction = True
            stamp.use_positive_direction = True
            stamp.offset = .000060
        if label in ('F', 'J') or (label == '5' and x > .10):
            bar_y = -depth / 2 + .0028
            box(f'keycap.homing.{key["slot"]}', (.0035, .00065, .00025),
                (0, bar_y, surface(0, bar_y) + .00015), m['mod'] if modifier else m['key'], .00012, parent)
    return keyboard


def validate_legends():
    """Catch glyphs buried in the cap even when slot picking still works."""
    from mathutils import Vector
    bpy.context.view_layer.update()
    deps = bpy.context.evaluated_depsgraph_get()
    checked, minimum = 0, 1.0
    for printing in bpy.context.scene.objects:
        if not printing.name.startswith('legend.') or not printing.parent:
            continue
        slot = printing.parent.get('slot_id')
        cap = bpy.data.objects.get(f'keycap.{slot}')
        if cap is None:
            continue
        evaluated = printing.evaluated_get(deps)
        mesh = evaluated.to_mesh()
        try:
            mesh.calc_loop_triangles()
            transform = cap.matrix_world.inverted() @ printing.matrix_world
            for triangle in mesh.loop_triangles:
                point = transform @ (sum((mesh.vertices[i].co for i in triangle.vertices), Vector()) / 3)
                hit, surface, _, _ = cap.ray_cast(Vector((point.x, point.y, .05)), Vector((0, 0, -1)))
                if hit:
                    clearance = point.z - surface.z
                    minimum = min(minimum, clearance)
                    if clearance < -.000005:
                        raise RuntimeError(f'Keyboard legend intersects cap: {printing.name}, {clearance:.7f} m')
                    checked += 1
        finally:
            evaluated.to_mesh_clear()
    return {'legendTrianglesChecked': checked, 'minimumClearanceMicrons': round(minimum * 1e6, 2)}
