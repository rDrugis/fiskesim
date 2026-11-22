# Blender (bakgrunn, Cycles): fotorealistisk dronebilde av terrenget uten vann, i ekte målestokk (ingen overdrivelse).
# Bruk: blender -b -P blender_scene.py -- <stedmappe> <ut.png> <asimut°> <høydevinkel°> <avstand m> [mål_z]
import bpy, bmesh, json, math, os, sys
import numpy as np
a = sys.argv[sys.argv.index('--') + 1:]
D, OUTP, AZ, EL, DIST = a[0], a[1], float(a[2]), float(a[3]), float(a[4])
TZ = float(a[5]) if len(a) > 5 else None
meta = json.load(open(os.path.join(D, 'meta.json'))); hm = np.load(os.path.join(D, 'hm.npy'))
size = meta['size']; n = hm.shape[0]
# høyst ca. 1400 × 1400 punkter i nettet
st = max(1, int(math.ceil(n / 1400))); g = hm[::st, ::st]; ny, nx = g.shape; cell = size / (nx - 1)
bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene

# --- terreng ---
xs = np.arange(nx) * cell - size / 2; ys = size / 2 - np.arange(ny) * cell
X, Y = np.meshgrid(xs, ys); V = np.stack([X.ravel(), Y.ravel(), g.ravel()], 1).astype(np.float32)
jj, ii = np.meshgrid(np.arange(ny - 1), np.arange(nx - 1), indexing='ij'); a0 = (jj * nx + ii).ravel()
Q = np.stack([a0, a0 + nx, a0 + nx + 1, a0 + 1], 1).astype(np.int32)
me = bpy.data.meshes.new('terreng')
me.vertices.add(len(V)); me.vertices.foreach_set('co', V.ravel())
me.loops.add(Q.size); me.loops.foreach_set('vertex_index', Q.ravel())
me.polygons.add(len(Q)); me.polygons.foreach_set('loop_start', (np.arange(len(Q)) * 4).astype(np.int32))
try: me.polygons.foreach_set('loop_total', np.full(len(Q), 4, np.int32))
except Exception: pass
me.update(calc_edges=True); me.validate()
for p in me.polygons: pass
me.shade_smooth() if hasattr(me, 'shade_smooth') else None
ter = bpy.data.objects.new('terreng', me); sc.collection.objects.link(ter)

def node_mat(name):
    m = bpy.data.materials.new(name); m.use_nodes = True; return m, m.node_tree.nodes, m.node_tree.links

# materiale: farge etter høyde og bratthet, med støy (havbunn: mudder → sand → stein/tang nær land; land: lyng, gress, berg)
m, N, L = node_mat('terreng')
bsdf = N['Principled BSDF']; geo = N.new('ShaderNodeNewGeometry'); sep = N.new('ShaderNodeSeparateXYZ'); L.new(geo.outputs['Position'], sep.inputs[0])
nsep = N.new('ShaderNodeSeparateXYZ'); L.new(geo.outputs['Normal'], nsep.inputs[0])
noise = N.new('ShaderNodeTexNoise'); noise.inputs['Scale'].default_value = 0.02; noise.inputs['Detail'].default_value = 8
tc = N.new('ShaderNodeTexCoord'); L.new(tc.outputs['Object'], noise.inputs['Vector'])
mapz = N.new('ShaderNodeMath'); mapz.operation = 'ADD'; L.new(sep.outputs['Z'], mapz.inputs[0])
nmul = N.new('ShaderNodeMath'); nmul.operation = 'MULTIPLY'; nmul.inputs[1].default_value = 18; L.new(noise.outputs['Fac'], nmul.inputs[0]); L.new(nmul.outputs[0], mapz.inputs[1])
norm = N.new('ShaderNodeMapRange'); norm.inputs['From Min'].default_value = -650; norm.inputs['From Max'].default_value = 400; L.new(mapz.outputs[0], norm.inputs['Value'])
ramp = N.new('ShaderNodeValToRGB'); L.new(norm.outputs[0], ramp.inputs['Fac'])
cr = ramp.color_ramp; cr.elements.remove(cr.elements[1])
def stop(z, rgb):
    e = cr.elements.new((z + 650) / 1050); e.color = (*rgb, 1)
cr.elements[0].position = 0; cr.elements[0].color = (0.10, 0.09, 0.08, 1)        # dypt mudder
stop(-300, (0.20, 0.18, 0.15)); stop(-80, (0.33, 0.30, 0.24)); stop(-25, (0.55, 0.50, 0.38))   # mudder → sand
stop(-6, (0.30, 0.28, 0.20)); stop(-1, (0.17, 0.15, 0.10))                         # tang og stein nær land
stop(1, (0.42, 0.40, 0.36)); stop(4, (0.30, 0.34, 0.20)); stop(60, (0.22, 0.30, 0.14)); stop(250, (0.36, 0.34, 0.24))
# bratt: berg
rock = N.new('ShaderNodeMix'); rock.data_type = 'RGBA'
steep = N.new('ShaderNodeMapRange'); steep.inputs['From Min'].default_value = 0.85; steep.inputs['From Max'].default_value = 0.6
L.new(nsep.outputs['Z'], steep.inputs['Value']); L.new(steep.outputs[0], rock.inputs['Factor'])
L.new(ramp.outputs['Color'], rock.inputs[6]); rock.inputs[7].default_value = (0.30, 0.29, 0.27, 1)
L.new(rock.outputs[2], bsdf.inputs['Base Color'])
bsdf.inputs['Roughness'].default_value = 0.9
bump = N.new('ShaderNodeBump'); bump.inputs['Strength'].default_value = 0.25
n2 = N.new('ShaderNodeTexNoise'); n2.inputs['Scale'].default_value = 0.4; n2.inputs['Detail'].default_value = 10; L.new(tc.outputs['Object'], n2.inputs['Vector'])
L.new(n2.outputs['Fac'], bump.inputs['Height']); L.new(bump.outputs['Normal'], bsdf.inputs['Normal'])
ter.data.materials.append(m)

def zat(x, y):
    i = int(round((x + size / 2) / cell)); j = int(round((size / 2 - y) / cell))
    return float(g[min(ny - 1, max(0, j)), min(nx - 1, max(0, i))])

# --- bygninger ---
mw, Nw, Lw = node_mat('vegg'); Nw['Principled BSDF'].inputs['Base Color'].default_value = (0.78, 0.76, 0.72, 1); Nw['Principled BSDF'].inputs['Roughness'].default_value = 0.7
mr, Nr, Lr = node_mat('tak'); Nr['Principled BSDF'].inputs['Base Color'].default_value = (0.12, 0.12, 0.13, 1); Nr['Principled BSDF'].inputs['Roughness'].default_value = 0.6
bm = bmesh.new()
for b in json.load(open(os.path.join(D, 'bygg.json'))):
    pts = [(x - size / 2, y - size / 2) for x, y in b['p']]
    if len(pts) > 1 and pts[0] == pts[-1]: pts = pts[:-1]
    if len(pts) < 3: continue
    cx = sum(p[0] for p in pts) / len(pts); cy = sum(p[1] for p in pts) / len(pts)
    if abs(cx) > size / 2 - 5 or abs(cy) > size / 2 - 5: continue
    base = max(zat(x, y) for x, y in pts) if True else 0
    if base < -0.5: continue          # bygg på pæler over vann (kai): stå på null
    vs = [bm.verts.new((x, y, base - 2)) for x, y in pts]
    try: f = bm.faces.new(vs)
    except Exception: continue
    if f.normal.z < 0: f.normal_flip()
    r = bmesh.ops.extrude_face_region(bm, geom=[f]); nv = [e for e in r['geom'] if isinstance(e, bmesh.types.BMVert)]
    bmesh.ops.translate(bm, verts=nv, vec=(0, 0, b['h'] + 2))
    for ff in r['geom']:
        if isinstance(ff, bmesh.types.BMFace): ff.material_index = 1
mb = bpy.data.meshes.new('bygg'); bm.to_mesh(mb); bm.free()
mb.materials.append(mw); mb.materials.append(mr)
ob = bpy.data.objects.new('bygg', mb); sc.collection.objects.link(ob)

# --- bruer: dekke som bånd; flytebru ca. 6 m over havflaten, ellers rett linje mellom landfestene ---
mc, Nc, Lc = node_mat('betong'); Nc['Principled BSDF'].inputs['Base Color'].default_value = (0.62, 0.62, 0.60, 1); Nc['Principled BSDF'].inputs['Roughness'].default_value = 0.6
bm = bmesh.new()
for br in json.load(open(os.path.join(D, 'bruer.json'))):
    pts = [(x - size / 2, y - size / 2) for x, y in br['p']]
    if len(pts) < 2: continue
    za, zb = max(zat(*pts[0]), 2), max(zat(*pts[-1]), 2)
    acc = [0]
    for k in range(1, len(pts)): acc.append(acc[-1] + math.dist(pts[k - 1], pts[k]))
    Ltot = acc[-1] or 1
    W2 = 6
    left, right = [], []
    for k, (x, y) in enumerate(pts):
        x0, y0 = pts[max(0, k - 1)]; x1, y1 = pts[min(len(pts) - 1, k + 1)]
        dx, dy = x1 - x0, y1 - y0; l = math.hypot(dx, dy) or 1; nxv, nyv = -dy / l, dx / l
        h = 6.0 if br['flyt'] else za + (zb - za) * acc[k] / Ltot
        left.append(bm.verts.new((x + nxv * W2, y + nyv * W2, h))); right.append(bm.verts.new((x - nxv * W2, y - nyv * W2, h)))
    for k in range(len(pts) - 1):
        try: bm.faces.new([left[k], right[k], right[k + 1], left[k + 1]])
        except Exception: pass
mbr = bpy.data.meshes.new('bruer'); bm.to_mesh(mbr); bm.free()
obr = bpy.data.objects.new('bruer', mbr); sc.collection.objects.link(obr); mbr.materials.append(mc)
sol = obr.modifiers.new('tykkelse', 'SOLIDIFY'); sol.thickness = 2.5

# --- lys og himmel ---
w = bpy.data.worlds.new('himmel'); sc.world = w; w.use_nodes = True
sky = w.node_tree.nodes.new('ShaderNodeTexSky')
for t in ('NISHITA', 'MULTIPLE_SCATTERING', 'SINGLE_SCATTERING', 'HOSEK_WILKIE'):
    try: sky.sky_type = t; break
    except Exception: pass
for k, v in (('sun_elevation', math.radians(28)), ('sun_rotation', math.radians(AZ + 140)), ('air_density', 1.2), ('dust_density', 2.5)):
    try: setattr(sky, k, v)
    except Exception: pass
w.node_tree.links.new(sky.outputs['Color'], w.node_tree.nodes['Background'].inputs['Color'])
w.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.35
sun = bpy.data.lights.new('sol', 'SUN'); sun.energy = 3.2; sun.angle = math.radians(1.5)
so = bpy.data.objects.new('sol', sun); sc.collection.objects.link(so)
so.rotation_euler = (math.radians(90 - 28), 0, math.radians(AZ + 140 + 90))

# --- kamera (drone) ---
tz = TZ if TZ is not None else float(np.percentile(g, 30)) * 0.5
cam = bpy.data.cameras.new('drone'); cam.lens = 24; cam.clip_end = 60000; cam.clip_start = 1
co = bpy.data.objects.new('drone', cam); sc.collection.objects.link(co); sc.camera = co
azr, elr = math.radians(AZ), math.radians(EL)
co.location = (math.sin(azr) * DIST * math.cos(elr), math.cos(azr) * DIST * math.cos(elr), tz + DIST * math.sin(elr))
import mathutils
dirv = mathutils.Vector((0, 0, tz)) - co.location; co.rotation_euler = dirv.to_track_quat('-Z', 'Y').to_euler()

# --- utgang ---
sc.render.engine = 'CYCLES'; sc.cycles.device = 'CPU'; sc.cycles.samples = 64
try: sc.cycles.use_denoising = True
except Exception: pass
sc.render.resolution_x, sc.render.resolution_y = 1920, 1080
sc.view_settings.view_transform = 'Filmic' if 'Filmic' in [v.identifier for v in type(sc.view_settings).bl_rna.properties['view_transform'].enum_items] else 'AgX'
sc.view_settings.look = 'None'
sc.render.filepath = OUTP; sc.render.image_settings.file_format = 'PNG'
bpy.ops.render.render(write_still=True)
print('ferdig', OUTP, flush=True)
