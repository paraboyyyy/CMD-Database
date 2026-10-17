import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { CSS2DObject, CSS2DRenderer } from "three/examples/jsm/renderers/CSS2DRenderer.js";
import { elementInfo } from "../lib/elements";
import {
  type Crystal,
  type DisplayAtom,
  type Mat3,
  type Vec3,
  buildSupercell,
  center,
  findBonds,
  fracToCart,
  norm,
} from "../lib/structure";

export type AtomStyle = "ball-stick" | "spacefill" | "stick" | "wireframe";

export interface ViewOptions {
  repeat: Vec3;
  boundary: boolean;
  showBonds: boolean;
  showCell: boolean;
  showAxes: boolean;
  showLabels: boolean;
  style: AtomStyle;
  atomScale: number;
  bondTolerance: number;
  orthographic: boolean;
}

export const DEFAULT_OPTIONS: ViewOptions = {
  repeat: [1, 1, 1],
  boundary: true,
  showBonds: true,
  showCell: true,
  showAxes: true,
  showLabels: false,
  style: "ball-stick",
  atomScale: 1,
  bondTolerance: 1.15,
  orthographic: false,
};

export interface SceneColors {
  background: string;
  cell: string;
  label: string;
}

const BOND_RADIUS = 0.12;
const MAX_LABELS = 400;
const AXIS_COLORS = ["#e5484d", "#30a46c", "#3e63dd"];

export function atomRadius(element: string, style: AtomStyle, scale: number): number {
  const r = elementInfo(element).covalentRadius;
  switch (style) {
    case "spacefill":
      return r * scale;
    case "stick":
      return BOND_RADIUS * scale;
    case "wireframe":
      return 0.05;
    default:
      return Math.max(r * 0.45, 0.2) * scale;
  }
}

/**
 * Imperative Three.js scene for one crystal frame. React components own one instance and
 * call setStructure/setOptions; it renders on demand (only when something changes).
 */
export class CrystalScene {
  readonly renderer: THREE.WebGLRenderer;
  private labelRenderer = new CSS2DRenderer();
  private scene = new THREE.Scene();
  private perspective = new THREE.PerspectiveCamera(35, 1, 0.1, 5000);
  private ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, -5000, 5000);
  private camera: THREE.PerspectiveCamera | THREE.OrthographicCamera = this.perspective;
  private controls: OrbitControls;
  private content = new THREE.Group();
  private atomMesh: THREE.InstancedMesh | null = null;
  private highlight = new THREE.Group();
  private axesScene = new THREE.Scene();
  private axesCamera = new THREE.OrthographicCamera(-1.6, 1.6, 1.6, -1.6, -10, 10);
  private axesGroup = new THREE.Group();
  private resizeObserver: ResizeObserver;
  private frameRequested = false;
  private pointerDown: { x: number; y: number } | null = null;

  private crystal: Crystal | null = null;
  private options: ViewOptions = DEFAULT_OPTIONS;
  private colors: SceneColors = { background: "#ffffff", cell: "#444444", label: "#111111" };
  private displayAtoms: DisplayAtom[] = [];
  private selected: number[] = [];
  private framed = false;

  onSelect: (atoms: DisplayAtom[]) => void = () => {};

  /** Edit mode: atoms can be dragged, clicks on empty space report a position. */
  editable = false;
  /** Atom `source` (index in the crystal) was dragged by `delta` (Cartesian Å). */
  onAtomDrag: (source: number, delta: Vec3) => void = () => {};
  /** Click on empty space in edit mode, at a point on the view plane through the cell centre. */
  onBackgroundClick: (cart: Vec3) => void = () => {};
  /** Click on an atom in edit mode (crystal atom index). */
  onAtomClick: (source: number) => void = () => {};
  private drag: { display: number; plane: THREE.Plane; start: THREE.Vector3; current: THREE.Vector3 } | null = null;

  constructor(private container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.autoClear = false;
    container.appendChild(this.renderer.domElement);

    Object.assign(this.labelRenderer.domElement.style, { position: "absolute", inset: "0", pointerEvents: "none" });
    container.appendChild(this.labelRenderer.domElement);

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x444466, 1.6));
    const key = new THREE.DirectionalLight(0xffffff, 1.6);
    key.position.set(1, 1.2, 2);
    this.perspective.add(key);
    this.ortho.add(key.clone());
    this.scene.add(this.perspective, this.ortho, this.content, this.highlight);
    this.axesScene.add(this.axesGroup, new THREE.AmbientLight(0xffffff, 3));

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.addEventListener("change", () => this.requestRender());

    const canvas = this.renderer.domElement;
    // Capture phase, so an atom drag can switch off OrbitControls before it starts rotating.
    canvas.addEventListener("pointerdown", (e) => this.handlePointerDown(e), true);
    canvas.addEventListener("pointermove", (e) => this.handlePointerMove(e));
    canvas.addEventListener("pointerup", (e) => this.handleClick(e));

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
  }

  setColors(colors: SceneColors) {
    this.colors = colors;
    this.renderer.setClearColor(colors.background);
    this.rebuild();
  }

  setStructure(crystal: Crystal | null, keepView = false) {
    this.crystal = crystal;
    this.selected = [];
    if (!keepView) this.framed = false;
    this.rebuild();
  }

  setOptions(options: ViewOptions) {
    const repeatChanged = options.repeat.join() !== this.options.repeat.join();
    const projectionChanged = options.orthographic !== this.options.orthographic;
    this.options = options;
    if (repeatChanged) {
      this.selected = [];
      this.framed = false;
    }
    if (projectionChanged) this.switchCamera();
    this.rebuild();
  }

  /** Look along a lattice vector (or the Cartesian axis for molecules). */
  viewAlong(axis: 0 | 1 | 2) {
    const target = this.controls.target.clone();
    const dist = this.camera.position.distanceTo(target);
    let dir: THREE.Vector3;
    if (this.crystal?.lattice) {
      dir = new THREE.Vector3(...this.crystal.lattice[axis]).normalize();
    } else {
      dir = new THREE.Vector3().setComponent(axis, 1);
    }
    // Keep "up" sensible: c up when looking along a or b, b up when looking along c.
    const upVec = this.crystal?.lattice?.[axis === 2 ? 1 : 2] ?? (axis === 2 ? [0, 1, 0] : [0, 0, 1]);
    this.camera.up.set(...(upVec as Vec3)).normalize();
    this.camera.position.copy(target).addScaledVector(dir, dist);
    this.camera.lookAt(target);
    this.controls.update();
    this.requestRender();
  }

  resetView() {
    this.framed = false;
    this.frameContent();
    this.requestRender();
  }

  clearSelection() {
    this.selected = [];
    this.updateHighlight();
  }

  toPNG(): string {
    this.render();
    return this.renderer.domElement.toDataURL("image/png");
  }

  dispose() {
    this.resizeObserver.disconnect();
    this.controls.dispose();
    this.clearContent();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.labelRenderer.domElement.remove();
  }

  // ---------------------------------------------------------------- building

  private clearContent() {
    for (const group of [this.content, this.highlight]) {
      group.traverse((obj) => {
        if (obj instanceof CSS2DObject) obj.element.remove();
        const mesh = obj as THREE.Mesh;
        mesh.geometry?.dispose();
        const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
        else mat?.dispose();
      });
      group.clear();
    }
    this.atomMesh = null;
  }

  private rebuild() {
    this.clearContent();
    this.buildAxes();
    const crystal = this.crystal;
    if (!crystal) {
      this.displayAtoms = [];
      this.requestRender();
      return;
    }
    const o = this.options;
    this.displayAtoms = buildSupercell(crystal, o.repeat, o.boundary);
    const atoms = this.displayAtoms;

    // Atoms: one instanced mesh, coloured per instance.
    const sphere = new THREE.SphereGeometry(1, 32, 16);
    const atomMat = new THREE.MeshStandardMaterial({ roughness: 0.45, metalness: 0.05 });
    const mesh = new THREE.InstancedMesh(sphere, atomMat, Math.max(atoms.length, 1));
    const m = new THREE.Matrix4();
    const color = new THREE.Color();
    atoms.forEach((a, i) => {
      const r = atomRadius(a.element, o.style, o.atomScale);
      m.makeScale(r, r, r).setPosition(...a.cart);
      mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, color.set(elementInfo(a.element).color));
    });
    mesh.count = atoms.length;
    this.atomMesh = mesh;
    this.content.add(mesh);

    if (o.showBonds && o.style !== "spacefill") this.buildBonds(atoms);
    if (o.showCell && crystal.lattice) this.buildCell(crystal.lattice);
    if (o.showLabels) this.buildLabels(atoms);

    this.updateHighlight(false);
    if (!this.framed) this.frameContent();
    this.requestRender();
  }

  private buildBonds(atoms: DisplayAtom[]) {
    const o = this.options;
    const bonds = findBonds(atoms, (e) => elementInfo(e).covalentRadius, o.bondTolerance);
    if (!bonds.length) return;
    const radius = o.style === "wireframe" ? 0.03 : BOND_RADIUS * (o.style === "stick" ? o.atomScale : 1);
    // Each bond is two half-cylinders so each half takes its atom's colour.
    const geom = new THREE.CylinderGeometry(1, 1, 1, 12, 1, true);
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.5 });
    const mesh = new THREE.InstancedMesh(geom, mat, bonds.length * 2);
    const up = new THREE.Vector3(0, 1, 0);
    const q = new THREE.Quaternion();
    const m = new THREE.Matrix4();
    const color = new THREE.Color();
    let n = 0;
    for (const b of bonds) {
      const p1 = new THREE.Vector3(...atoms[b.i].cart);
      const p2 = new THREE.Vector3(...atoms[b.j].cart);
      const dir = p2.clone().sub(p1);
      q.setFromUnitVectors(up, dir.clone().normalize());
      const half = b.length / 2;
      for (const [start, el] of [
        [p1, atoms[b.i].element],
        [p1.clone().addScaledVector(dir, 0.5), atoms[b.j].element],
      ] as const) {
        const mid = start.clone().addScaledVector(dir, 0.25);
        m.compose(mid, q, new THREE.Vector3(radius, half, radius));
        mesh.setMatrixAt(n, m);
        mesh.setColorAt(n++, color.set(elementInfo(el).color));
      }
    }
    this.content.add(mesh);
  }

  private buildCell(lattice: Mat3) {
    const corners: Vec3[] = [];
    for (const f of [
      [0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1],
      [1, 1, 0], [1, 0, 1], [0, 1, 1], [1, 1, 1],
    ] as Vec3[])
      corners.push(fracToCart(f, lattice));
    const edges = [
      [0, 1], [0, 2], [0, 3], [1, 4], [1, 5], [2, 4],
      [2, 6], [3, 5], [3, 6], [4, 7], [5, 7], [6, 7],
    ];
    const pts = edges.flatMap(([i, j]) => [...corners[i], ...corners[j]]);
    const geom = new THREE.BufferGeometry();
    geom.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    const lines = new THREE.LineSegments(geom, new THREE.LineBasicMaterial({ color: this.colors.cell }));
    this.content.add(lines);
  }

  private buildLabels(atoms: DisplayAtom[]) {
    atoms.slice(0, MAX_LABELS).forEach((a) => {
      const el = document.createElement("span");
      el.className = "atom-label";
      el.textContent = a.label && a.label !== a.element ? a.label : a.element;
      el.style.color = this.colors.label;
      const obj = new CSS2DObject(el);
      obj.position.set(...a.cart);
      this.content.add(obj);
    });
  }

  private buildAxes() {
    this.axesGroup.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      mesh.geometry?.dispose();
      (mesh.material as THREE.Material | undefined)?.dispose();
    });
    this.axesGroup.clear();
    const lattice = this.crystal?.lattice;
    const dirs: Vec3[] = lattice ?? [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
    const names = lattice ? ["a", "b", "c"] : ["x", "y", "z"];
    dirs.forEach((d, i) => {
      const dir = new THREE.Vector3(...d).divideScalar(norm(d));
      const arrow = new THREE.ArrowHelper(dir, new THREE.Vector3(), 1, AXIS_COLORS[i], 0.3, 0.16);
      this.axesGroup.add(arrow);
      const sprite = textSprite(names[i], AXIS_COLORS[i]);
      sprite.position.copy(dir.multiplyScalar(1.35));
      this.axesGroup.add(sprite);
    });
  }

  private updateHighlight(render = true) {
    this.highlight.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      mesh.geometry?.dispose();
      (mesh.material as THREE.Material | undefined)?.dispose();
    });
    this.highlight.clear();
    const o = this.options;
    for (const i of this.selected) {
      const a = this.displayAtoms[i];
      if (!a) continue;
      const r = atomRadius(a.element, o.style, o.atomScale) * 1.25 + 0.05;
      const ring = new THREE.Mesh(
        new THREE.SphereGeometry(r, 24, 12),
        new THREE.MeshBasicMaterial({ color: "#ffb224", transparent: true, opacity: 0.45, depthWrite: false }),
      );
      ring.position.set(...a.cart);
      this.highlight.add(ring);
    }
    this.onSelect(this.selected.map((i) => this.displayAtoms[i]).filter(Boolean));
    if (render) this.requestRender();
  }

  // ---------------------------------------------------------------- camera

  private frameContent() {
    if (!this.crystal || !this.displayAtoms.length) return;
    const c = center(this.displayAtoms, this.crystal.lattice, this.options.repeat);
    const target = new THREE.Vector3(...c);
    let radius = 0;
    const pts: Vec3[] = this.displayAtoms.map((a) => a.cart);
    if (this.crystal.lattice) {
      const r = this.options.repeat;
      for (const f of [[0, 0, 0], [r[0], r[1], r[2]], [r[0], 0, 0], [0, r[1], 0], [0, 0, r[2]], [r[0], r[1], 0], [r[0], 0, r[2]], [0, r[1], r[2]]] as Vec3[])
        pts.push(fracToCart(f, this.crystal.lattice));
    }
    for (const p of pts) radius = Math.max(radius, target.distanceTo(new THREE.Vector3(...p)));
    radius = Math.max(radius + 1.5, 3);

    // Fit the bounding sphere in whichever field of view is narrower (tall panels are width-limited).
    const { clientWidth: w, clientHeight: h } = this.container;
    const aspect = w && h ? w / h : 1;
    const vfov = (this.perspective.fov * Math.PI) / 180;
    const fov = Math.min(vfov, 2 * Math.atan(Math.tan(vfov / 2) * aspect));
    const dist = radius / Math.sin(fov / 2);
    // A slightly rotated default view shows the 3D shape of the cell.
    const dir = new THREE.Vector3(0.9, -1.6, 0.7).normalize();
    for (const cam of [this.perspective, this.ortho]) {
      cam.up.set(0, 0, 1);
      cam.position.copy(target).addScaledVector(dir, dist);
      cam.lookAt(target);
    }
    this.ortho.zoom = 1;
    this.orthoHalfHeight = (radius * 1.05) / Math.min(1, aspect);
    this.perspective.far = dist * 10;
    this.perspective.updateProjectionMatrix();
    this.updateOrtho();
    this.controls.target.copy(target);
    this.controls.update();
    this.framed = true;
  }

  private orthoHalfHeight = 10;

  private updateOrtho() {
    const { clientWidth: w, clientHeight: h } = this.container;
    const aspect = w / Math.max(h, 1);
    const hh = this.orthoHalfHeight;
    Object.assign(this.ortho, { left: -hh * aspect, right: hh * aspect, top: hh, bottom: -hh });
    this.ortho.updateProjectionMatrix();
  }

  private switchCamera() {
    const from = this.camera;
    const to = this.options.orthographic ? this.ortho : this.perspective;
    if (from === to) return;
    to.position.copy(from.position);
    to.up.copy(from.up);
    to.lookAt(this.controls.target);
    this.camera = to;
    this.controls.object = to;
    this.controls.update();
  }

  private resize() {
    const { clientWidth: w, clientHeight: h } = this.container;
    if (!w || !h) return;
    this.renderer.setSize(w, h);
    this.labelRenderer.setSize(w, h);
    this.perspective.aspect = w / h;
    this.perspective.updateProjectionMatrix();
    this.updateOrtho();
    this.requestRender();
  }

  // ---------------------------------------------------------------- picking

  private raycaster(clientX: number, clientY: number): THREE.Raycaster {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    return ray;
  }

  private hitDisplayAtom(clientX: number, clientY: number): number | null {
    if (!this.atomMesh) return null;
    return this.raycaster(clientX, clientY).intersectObject(this.atomMesh)[0]?.instanceId ?? null;
  }

  /** Crystal atom index under the cursor, or null. */
  pickAtom(clientX: number, clientY: number): number | null {
    const i = this.hitDisplayAtom(clientX, clientY);
    return i === null ? null : this.displayAtoms[i].index;
  }

  /** Point under the cursor on the plane facing the camera through the view centre. */
  pointOnViewPlane(clientX: number, clientY: number): Vec3 {
    const normal = this.camera.getWorldDirection(new THREE.Vector3());
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, this.controls.target);
    const p = this.raycaster(clientX, clientY).ray.intersectPlane(plane, new THREE.Vector3()) ?? this.controls.target.clone();
    return [p.x, p.y, p.z];
  }

  private handlePointerDown(e: PointerEvent) {
    this.pointerDown = { x: e.clientX, y: e.clientY };
    if (!this.editable || e.button !== 0) return;
    const i = this.hitDisplayAtom(e.clientX, e.clientY);
    if (i === null) return;
    const start = new THREE.Vector3(...this.displayAtoms[i].cart);
    const normal = this.camera.getWorldDirection(new THREE.Vector3());
    this.drag = { display: i, plane: new THREE.Plane().setFromNormalAndCoplanarPoint(normal, start), start, current: start.clone() };
    this.controls.enabled = false;
    this.renderer.domElement.setPointerCapture(e.pointerId);
    this.renderer.domElement.style.cursor = "grabbing";
  }

  private handlePointerMove(e: PointerEvent) {
    const canvas = this.renderer.domElement;
    if (!this.drag) {
      if (this.editable && e.buttons === 0) canvas.style.cursor = this.hitDisplayAtom(e.clientX, e.clientY) === null ? "" : "grab";
      return;
    }
    const p = this.raycaster(e.clientX, e.clientY).ray.intersectPlane(this.drag.plane, new THREE.Vector3());
    if (!p || !this.atomMesh) return;
    this.drag.current.copy(p);
    // Move just this instance while dragging; bonds and symmetry images update on release.
    const a = this.displayAtoms[this.drag.display];
    const r = atomRadius(a.element, this.options.style, this.options.atomScale);
    this.atomMesh.setMatrixAt(this.drag.display, new THREE.Matrix4().makeScale(r, r, r).setPosition(p));
    this.atomMesh.instanceMatrix.needsUpdate = true;
    this.requestRender();
  }

  private handleClick(e: PointerEvent) {
    const start = this.pointerDown;
    this.pointerDown = null;
    if (this.drag) {
      const { display, start: from, current } = this.drag;
      this.drag = null;
      this.controls.enabled = true;
      this.renderer.domElement.style.cursor = "";
      if (current.distanceTo(from) > 0.02) {
        const d = current.clone().sub(from);
        this.onAtomDrag(this.displayAtoms[display].index, [d.x, d.y, d.z]);
        return;
      }
    }
    if (!start || Math.hypot(e.clientX - start.x, e.clientY - start.y) > 4 || !this.atomMesh) return;
    const i = this.hitDisplayAtom(e.clientX, e.clientY);
    if (this.editable) {
      if (i === null) this.onBackgroundClick(this.pointOnViewPlane(e.clientX, e.clientY));
      else this.onAtomClick(this.displayAtoms[i].index);
    }
    // Click toggles an atom; up to 4 atoms give distance, angle and dihedral. Empty space clears.
    if (i === null) this.selected = [];
    else if (this.selected.includes(i)) this.selected = this.selected.filter((s) => s !== i);
    else this.selected = this.selected.length >= 4 ? [i] : [...this.selected, i];
    this.updateHighlight();
  }

  // ---------------------------------------------------------------- render

  requestRender() {
    if (this.frameRequested) return;
    this.frameRequested = true;
    requestAnimationFrame(() => {
      this.frameRequested = false;
      this.render();
    });
  }

  private render() {
    const { clientWidth: w, clientHeight: h } = this.container;
    this.renderer.setViewport(0, 0, w, h);
    this.renderer.clear();
    this.renderer.render(this.scene, this.camera);
    this.labelRenderer.render(this.scene, this.camera);

    if (this.options.showAxes) {
      const size = Math.min(110, w / 4, h / 4);
      this.axesCamera.position.copy(this.camera.position).sub(this.controls.target).setLength(5);
      this.axesCamera.up.copy(this.camera.up);
      this.axesCamera.lookAt(0, 0, 0);
      this.renderer.clearDepth();
      this.renderer.setViewport(8, 8, size, size);
      this.renderer.render(this.axesScene, this.axesCamera);
    }
  }
}

function textSprite(text: string, color: string): THREE.Sprite {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext("2d")!;
  ctx.font = "italic 600 44px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = color;
  ctx.fillText(text, 32, 34);
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas), depthTest: false }),
  );
  sprite.scale.set(0.5, 0.5, 0.5);
  return sprite;
}
