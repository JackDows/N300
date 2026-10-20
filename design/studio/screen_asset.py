"""A packed display surface. Device silhouettes and interactions stay geometry.

The wallpaper is authored at panel resolution, with broad tonal bands rather
than subpixel world-space curves. It has its own UVs and emits a little light;
room lights cannot turn the LCD into an unlit black rectangle.
"""
import math
import bpy
import numpy as np


def build_display(parent, M, root, box, text):
    body = root('monitor.panel', (0, 0, .312), parent)
    box('monitor.rear.shell', (.610, .028, .347), (0, .008, 0), M['shell'], .0045, body)
    box('monitor.front.bezel', (.615, .007, .353), (0, -.008, 0), M['black'], .0025, body)
    # Fine rear ventilation is subordinate to the continuous bezel silhouette.
    for i in range(22):
        box('monitor.rear.vent', (.014, .0007, .001),
            (-.231+i*.022, .0225, .104), M['black'], .00025, body)
    box('monitor.chin', (.610, .002, .008), (0, -.012, -.171), M['shell'], .001, body)
    text('monitor.wordmark', 'AOC', (0, -.0132, -.171), .0035, M['steel'], body, (math.pi/2, 0, 0))
    box('monitor.indicator', (.003, .0006, .0007), (.274, -.0132, -.171), M['status'], .0002, body)

    width, height = 2048, 1152
    y, x = np.mgrid[0:height, 0:width].astype(np.float32)
    x /= width-1
    y /= height-1
    # Reuse the established scene palette in linear colour space.
    colors = {
        name: np.array(M[name].diffuse_color[:3], dtype=np.float32)
        for name in ('screen', 'trace', 'cyan', 'steel')
    }
    image = np.empty((height, width, 4), dtype=np.float32)
    image[:, :, :3] = colors['screen']
    field = np.exp(-((x-.72)/.65)**2 - ((y-.43)/.55)**2)
    image[:, :, :3] += field[:, :, None]*colors['trace']*.18
    for i in range(3):
        curve = .33+.13*i+.12*np.sin((x-.17)*3.3)
        d = y-curve
        edge = np.exp(-(d/.009)**2)
        shoulder = np.exp(-(d/.090)**2) * np.clip(d/.012+.35, 0, 1)
        sweep = np.exp(-((x-.55+i*.09)/.7)**2)
        image[:, :, :3] += (shoulder*.21+edge*.055)[:, :, None]*sweep[:, :, None]*colors['cyan']
    image[:, :, :3] = np.clip(image[:, :, :3], 0, 1)
    image[:, :, 3] = 1
    texture = bpy.data.images.new('Display / quiet glass waves', width, height, alpha=True)
    # The glTF emissive texture is sampled as sRGB. Encode the authored linear
    # values once here, rather than exporting linear bytes as a colour PNG.
    image[:, :, :3] = np.where(
        image[:, :, :3] <= .0031308, image[:, :, :3]*12.92,
        1.055*image[:, :, :3]**(1/2.4)-.055)
    texture.colorspace_settings.name = 'sRGB'
    texture.pixels.foreach_set(image.ravel())
    texture.pack()

    material = bpy.data.materials.new('Display / emissive panel')
    material.use_nodes = True
    nodes = material.node_tree.nodes
    nodes.clear()
    output = nodes.new('ShaderNodeOutputMaterial')
    emission = nodes.new('ShaderNodeEmission')
    emission.inputs['Strength'].default_value = 1
    tex = nodes.new('ShaderNodeTexImage')
    tex.image = texture
    material.node_tree.links.new(tex.outputs['Color'], emission.inputs['Color'])
    material.node_tree.links.new(emission.outputs['Emission'], output.inputs['Surface'])
    mesh = bpy.data.meshes.new('monitor.display')
    mesh.from_pydata([(-.299, -.0121, -.165), (.299, -.0121, -.165),
                      (.299, -.0121, .172), (-.299, -.0121, .172)], [], [(0, 1, 2, 3)])
    mesh.update()
    uv = mesh.uv_layers.new(name='DisplayUV')
    for loop, value in zip(uv.data, [(0, 0), (1, 0), (1, 1), (0, 1)]):
        loop.uv = value
    ob = bpy.data.objects.new('monitor.display', mesh)
    bpy.context.scene.collection.objects.link(ob)
    ob.parent = body
    ob['preserve_uv'] = True
    mesh.materials.append(material)
    text('monitor.brand', 'DeskHub', (-.218, -.0124, .125), .0135, M['legend'], body, (math.pi/2, 0, 0))
    return body
