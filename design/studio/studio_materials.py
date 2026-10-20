"""Small, deterministic PBR surface maps, packed into the editable scene and GLB.

The UV scale is physical (one tile = 20 mm), so a surface does not turn coarse
when the device is enlarged. These are material data, not device illustrations.
"""
import bpy
import numpy as np

TILE_METRES = .020


def packed_image(name, rgb):
    height, width, _ = rgb.shape
    pixels = np.ones((height, width, 4), dtype=np.float32)
    pixels[:, :, :3] = np.clip(rgb, 0, 1)
    image = bpy.data.images.new(name, width=width, height=height, alpha=False)
    image.colorspace_settings.name = 'Non-Color'
    image.pixels.foreach_set(pixels.ravel())
    image.pack()
    return image


def surface_maps(name, kind, seed):
    rng = np.random.default_rng(seed)
    n = 256
    noise = rng.random((n, n))
    grain = (noise + np.roll(noise, 1, 0) + np.roll(noise, 1, 1)) / 3
    if kind == 'fabric':
        y, x = np.mgrid[:n, :n]
        warp = np.cos(x * np.pi / 4)
        weft = np.cos(y * np.pi / 4)
        interlace = np.cos(x * np.pi / 8) * np.cos(y * np.pi / 8)
        height = .35 * (warp + weft) + .22 * interlace + .08 * grain
        roughness = .86 + .06 * grain
        strength = .24
    elif kind == 'metal':
        streak = rng.random((n, 1))
        height = .7 * streak + .3 * grain
        roughness = .42 + .045 * streak + .035 * grain
        strength = .10
    else:
        height = grain
        roughness = .53 + .10 * grain
        strength = .16
    dx = (np.roll(height, -1, 1) - np.roll(height, 1, 1)) * strength
    dy = (np.roll(height, -1, 0) - np.roll(height, 1, 0)) * strength
    normals = np.stack((-dx, -dy, np.ones_like(dx)), axis=-1)
    normals /= np.linalg.norm(normals, axis=-1, keepdims=True)
    normal = packed_image(name + ' / normal', normals * .5 + .5)
    rough = packed_image(name + ' / roughness', np.stack([roughness] * 3, axis=-1))
    return normal, rough


def apply_surface(material, maps):
    nodes, links = material.node_tree.nodes, material.node_tree.links
    shader = nodes.get('Principled BSDF')
    normal_image, roughness_image = maps
    normal_texture = nodes.new('ShaderNodeTexImage')
    normal_texture.image = normal_image
    normal_texture.interpolation = 'Linear'
    normal = nodes.new('ShaderNodeNormalMap')
    normal.inputs['Strength'].default_value = 1
    links.new(normal_texture.outputs['Color'], normal.inputs['Color'])
    links.new(normal.outputs['Normal'], shader.inputs['Normal'])
    rough_texture = nodes.new('ShaderNodeTexImage')
    rough_texture.image = roughness_image
    links.new(rough_texture.outputs['Color'], shader.inputs['Roughness'])


def prepare_surfaces(materials):
    pbt = surface_maps('Fine moulded polymer', 'polymer', 98)
    aluminium = surface_maps('Satin aluminium', 'metal', 300)
    fabric = surface_maps('Woven desk mat', 'fabric', 5080)
    for name in ('key', 'mod', 'ivory', 'shell'):
        apply_surface(materials[name], pbt)
    for name in ('silver', 'steel', 'bezel'):
        apply_surface(materials[name], aluminium)
    apply_surface(materials['fabric'], fabric)
    # Desk grain is very fine. Its lower normal strength keeps the broad plane quiet.
    apply_surface(materials['desk'], pbt)
    materials['desk'].node_tree.nodes.get('Normal Map').inputs['Strength'].default_value = .25


def physical_uvs(mesh):
    """Box projection also works on the curved key tops; no export-only shader."""
    uv = mesh.uv_layers.active or mesh.uv_layers.new(name='SurfaceUV')
    for polygon in mesh.polygons:
        axis = max(range(3), key=lambda i: abs(polygon.normal[i]))
        axes = ((1, 2), (0, 2), (0, 1))[axis]
        sign = -1 if polygon.normal[axis] < 0 else 1
        for loop in polygon.loop_indices:
            co = mesh.vertices[mesh.loops[loop].vertex_index].co
            uv.data[loop].uv = (co[axes[0]] * sign / TILE_METRES, co[axes[1]] / TILE_METRES)
