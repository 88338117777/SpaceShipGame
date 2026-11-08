import * as T from "../vendor/three.module.js";
import {
  ANCHORS,
  anchorGrip,
  BOXES,
  PACKS,
  METEORS,
  meteorPosition,
  podPosition,
  V,
} from "./physics.mjs";
const C = {
  hull: 0x647781,
  dark: 0x1b303c,
  cyan: 0x8ae4da,
  amber: 0xf1ba79,
  green: 0xc3f285,
};
export class View {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new T.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
    this.renderer.setClearColor(0x030711);
    this.renderer.toneMapping = T.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.scene = new T.Scene();
    this.camera = new T.PerspectiveCamera(76, 1, 0.04, 2500);
    this.camera.rotation.order = "YXZ";
    this.scene.add(this.camera);
    this.scene.add(new T.HemisphereLight(0xc6e5ff, 0x263449, 1.5));
    const sun = new T.DirectionalLight(0xfff0da, 3.5);
    sun.position.set(50, 80, 40);
    this.scene.add(sun);
    const rim = new T.DirectionalLight(0x6cafff, 1.5);
    rim.position.set(-60, -20, -150);
    this.scene.add(rim);
    this.camera.add(new T.PointLight(0xbee9e6, 12, 8));
    this.world = new T.Group();
    this.scene.add(this.world);
    this.markers = [];
    this.rocks = new Map();
    this.packs = new Map();
    this.makeSky();
    this.makeStation();
    this.makeArms();
    this.makePod();
    this.meteors = METEORS.map((m, i) =>
      this.mesh(
        new T.IcosahedronGeometry(m.r, i % 2),
        this.mat(i % 3 === 0 ? 0x6e6257 : 0x81858a, { flatShading: true }),
        [0, 0, 0],
      ),
    );
    this.createMarkers();
    this.resize();
    new ResizeObserver(() => this.resize()).observe(canvas);
    this.hitTime = -10;
  }
  mat(color, extra = {}) {
    return new T.MeshStandardMaterial({
      color,
      roughness: 0.7,
      metalness: 0.55,
      ...extra,
    });
  }
  mesh(g, m, p, parent = this.world) {
    const o = new T.Mesh(g, m);
    o.position.set(...p);
    parent.add(o);
    return o;
  }
  box(p, size, color, parent = this.world, extra = {}) {
    return this.mesh(
      new T.BoxGeometry(...size),
      this.mat(color, extra),
      p,
      parent,
    );
  }
  rod(a, b, r, color, parent = this.world) {
    const v1 = new T.Vector3(...a),
      v2 = new T.Vector3(...b),
      d = v2.clone().sub(v1);
    const o = this.mesh(
      new T.CylinderGeometry(r, r, d.length(), 8),
      this.mat(color),
      v1.add(v2).multiplyScalar(0.5).toArray(),
      parent,
    );
    o.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), d.normalize());
    return o;
  }
  labelTexture(text, bg = "#253b47", fg = "#b6dedc") {
    const c = document.createElement("canvas");
    c.width = 512;
    c.height = 128;
    const ctx = c.getContext("2d");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, 512, 128);
    ctx.fillStyle = fg;
    ctx.font = "bold 46px monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, 256, 64);
    const texture = new T.CanvasTexture(c);
    texture.colorSpace = T.SRGBColorSpace;
    return texture;
  }
  sign(text, p, width = 3) {
    const m = new T.MeshBasicMaterial({
      map: this.labelTexture(text),
      side: T.DoubleSide,
    });
    const o = this.mesh(new T.PlaneGeometry(width, width / 4), m, p);
    o.rotation.y = Math.PI / 2;
    return o;
  }
  makeSky() {
    let seed = 302;
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    const positions = [];
    for (let i = 0; i < 1700; i++) {
      let a = rand() * Math.PI * 2,
        b = Math.acos(rand() * 2 - 1),
        r = 700 + rand() * 300;
      positions.push(
        r * Math.sin(b) * Math.cos(a),
        r * Math.cos(b),
        r * Math.sin(b) * Math.sin(a) - 50,
      );
    }
    const geo = new T.BufferGeometry();
    geo.setAttribute("position", new T.Float32BufferAttribute(positions, 3));
    this.scene.add(
      new T.Points(
        geo,
        new T.PointsMaterial({
          size: 1.2,
          color: 0xd5e6ff,
          sizeAttenuation: true,
          transparent: true,
          opacity: 0.7,
        }),
      ),
    );
    const earthMaterial = new T.ShaderMaterial({
      uniforms: { sun: { value: new T.Vector3(1, 1, 1).normalize() } },
      vertexShader:
        "varying vec3 n; varying vec3 p; void main(){n=normalize(normalMatrix*normal);p=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}",
      fragmentShader:
        "varying vec3 n; varying vec3 p; float pattern(vec3 p){return sin(p.x*.048+sin(p.y*.07)*2.)+sin(p.y*.05+p.z*.035)+sin(p.z*.062+p.x*.02)*.6;} void main(){float f=pattern(p);float land=smoothstep(.45,.7,f);vec3 sea=vec3(.025,.12,.26);vec3 soil=vec3(.13,.27,.24);vec3 col=mix(sea,soil,land);float cloud=smoothstep(1.2,1.8,pattern(p*1.8+vec3(20.,40.,15.)));col=mix(col,vec3(.7,.8,.87),cloud*.65);float lit=max(.12,dot(normalize(n),normalize(vec3(-.3,.7,.6))));float rim=pow(1.-max(0.,n.z),3.);gl_FragColor=vec4(col*lit+vec3(.05,.16,.3)*rim,1.);}",
    });
    const earth = this.mesh(
      new T.SphereGeometry(250, 64, 48),
      earthMaterial,
      [350, -330, -400],
      this.scene,
    );
    earth.rotation.z = 0.35;
    this.mesh(
      new T.SphereGeometry(254, 48, 32),
      new T.MeshBasicMaterial({
        color: 0x70bfff,
        transparent: true,
        opacity: 0.08,
        side: T.BackSide,
        depthWrite: false,
        blending: T.AdditiveBlending,
      }),
      [350, -330, -400],
      this.scene,
    );
  }
  makeStation() {
    for (const b of BOXES) {
      if (b.kind === "solar") continue;
      const o = this.box(
        b.p,
        b.size,
        b.kind === "hull" ? C.hull : b.kind === "panel" ? 0x243e5a : 0x7f8178,
      );
      const edge = new T.LineSegments(
        new T.EdgesGeometry(o.geometry),
        new T.LineBasicMaterial({
          color: b.kind === "hull" ? 0x8799a1 : 0xcab28d,
          transparent: true,
          opacity: 0.4,
        }),
      );
      o.add(edge);
      if (b.kind === "hull") {
        const [x, y, z] = b.p;
        this.box([x + 5.035, y, z], [0.08, 6, 13], 0x879197);
        for (const dz of [-6.5, -2, 2, 6.5])
          this.box([x + 5.1, y, z + dz], [0.1, 8, 0.035], 0x35434b);
        for (const dy of [-3.7, 3.7])
          this.box(
            [x + 5.13, y + dy, z],
            [0.08, 0.055, 12],
            C.cyan,
            this.world,
            { emissive: C.cyan, emissiveIntensity: 0.9 },
          );
        for (let j = 0; j < 4; j++) {
          this.box(
            [x + 5.2, y - 1.4 + j * 0.7, z + 4],
            [0.15, 0.38, 2.4],
            0x203641,
          );
        }
        this.sign("KEPLER / " + b.id.slice(-1), [x + 5.22, y + 2, z - 2], 4);
        this.makeSolar(x, y + 6, z);
      } else {
        for (let j = 0; j < 5; j++) {
          const stripe = this.box(
            [
              b.p[0] - b.size[0] / 2 + 0.4 + (j * (b.size[0] - 0.8)) / 4,
              b.p[1],
              b.p[2] + b.size[2] / 2 + 0.03,
            ],
            [0.15, b.size[1], 0.05],
            C.amber,
          );
          stripe.rotation.z = 0.03;
        }
      }
    }
    for (const a of ANCHORS) {
      const p = anchorGrip(a);
      this.box([a.p[0], a.p[1] - 1.4, a.p[2]], [3.5, 0.2, 3.5], 0x465661);
      this.rod(
        [-4, a.p[1] - 1.5, a.p[2]],
        [a.p[0], a.p[1] - 1.5, a.p[2]],
        0.15,
        0x7f8b90,
      );
      this.rod(
        [p[0], p[1] - 0.3, p[2] - 0.6],
        [p[0], p[1] - 0.3, p[2] + 0.6],
        0.09,
        C.amber,
      );
      this.rod(
        [p[0], p[1] - 0.3, p[2] - 0.6],
        [p[0], p[1] + 0.3, p[2] - 0.6],
        0.07,
        C.amber,
      );
      this.rod(
        [p[0], p[1] - 0.3, p[2] + 0.6],
        [p[0], p[1] + 0.3, p[2] + 0.6],
        0.07,
        C.amber,
      );
      this.box(
        [a.p[0], a.p[1] - 1.26, a.p[2] - 1.5],
        [2.6, 0.05, 0.08],
        C.cyan,
        this.world,
        { emissive: C.cyan, emissiveIntensity: 1.2 },
      );
      this.mesh(
        new T.SphereGeometry(0.1, 8, 6),
        this.mat(C.cyan, { emissive: C.cyan, emissiveIntensity: 2 }),
        [p[0], p[1] + 0.35, p[2]],
      );
    }
    for (const p of PACKS) {
      const g = new T.Group();
      g.position.set(...p.p);
      this.world.add(g);
      this.box([0, 0, 0], [0.6, 0.45, 0.3], 0xdabf83, g);
      this.box([0, 0, 0.17], [0.48, 0.32, 0.06], 0x253b47, g);
      this.box([0, 0, 0.21], [0.28, 0.05, 0.02], C.cyan, g, {
        emissive: C.cyan,
        emissiveIntensity: 1.5,
      });
      this.box([0, 0, 0.21], [0.05, 0.2, 0.02], C.cyan, g, {
        emissive: C.cyan,
        emissiveIntensity: 1.5,
      });
      this.rod([-0.32, -0.1, 0], [-0.32, 0.2, 0], 0.1, 0xc5d5d2, g);
      this.packs.set(p.id, g);
    }
    // Small pieces are visual only; dangerous meteors are the larger moving bodies.
    for (let i = 0; i < 25; i++) {
      const p = [8 + Math.sin(i * 2.4) * 9, -6 + Math.cos(i) * 7, -8 - i * 4.7];
      const m = this.box(p, [0.12, 0.12, 0.4], 0x53616b);
      m.rotation.set(i * 0.7, i * 0.3, i);
    }
    this.cable = new T.Line(
      new T.BufferGeometry().setFromPoints([new T.Vector3(), new T.Vector3()]),
      new T.LineBasicMaterial({ color: 0xe0cb93 }),
    );
    this.scene.add(this.cable);
    this.cable.visible = false;
  }
  makeSolar(x, y, z) {
    this.rod([x, y - 1, z], [x + 14, y - 1, z], 0.1, 0x7b888e);
    const panel = this.box([x + 14, y - 1, z], [9, 0.12, 10], 0x122e51);
    panel.rotation.z = 0;
    for (let a = 0; a < 8; a++)
      this.box([x + 10 + a, y - 0.91, z], [0.025, 0.025, 9.8], 0x4c6c85);
    for (let a = 0; a < 6; a++)
      this.box(
        [x + 14, y - 0.89, z - 4 + a * 1.6],
        [8.8, 0.02, 0.025],
        0x4c6c85,
      );
  }
  makeArms() {
    this.arms = new T.Group();
    this.camera.add(this.arms);
    const metal = this.mat(0xadb9b6, { roughness: 0.45, metalness: 0.8 }),
      black = this.mat(0x15232b);
    this.upper = this.mesh(
      new T.CylinderGeometry(0.11, 0.14, 1, 10),
      metal,
      [0, 0, 0],
      this.arms,
    );
    this.lower = this.mesh(
      new T.CylinderGeometry(0.075, 0.095, 1, 10),
      metal,
      [0, 0, 0],
      this.arms,
    );
    this.elbow = this.mesh(
      new T.SphereGeometry(0.15, 12, 8),
      black,
      [0, 0, 0],
      this.arms,
    );
    this.wrist = new T.Group();
    this.arms.add(this.wrist);
    this.mesh(
      new T.BoxGeometry(0.19, 0.15, 0.18),
      black,
      [0, 0, 0],
      this.wrist,
    );
    this.box([0, 0.08, 0], [0.13, 0.025, 0.06], C.cyan, this.wrist, {
      emissive: C.cyan,
      emissiveIntensity: 1,
    });
    this.fingers = [];
    for (const x of [-0.11, 0.11]) {
      const f = this.box(
        [x, -0.015, -0.16],
        [0.045, 0.07, 0.2],
        0x99a6a3,
        this.wrist,
      );
      this.fingers.push(f);
    }
    this.left = new T.Group();
    this.arms.add(this.left);
    this.box([0, 0, 0], [0.22, 0.17, 0.32], 0x708b8f, this.left);
    this.box([0, -0.02, -0.17], [0.18, 0.13, 0.12], 0xbac8bd, this.left);
    this.tapeRoll = this.mesh(
      new T.TorusGeometry(0.12, 0.055, 8, 20),
      this.mat(0xc4bb91),
      [0, 0.12, -0.16],
      this.left,
    );
    this.tapeRoll.rotation.x = Math.PI / 2;
    this.chest = this.box(
      [0, -0.63, -0.86],
      [0.45, 0.2, 0.28],
      0x54666e,
      this.arms,
    );
    this.chest.visible = false;
    this.tapeStrip = this.box(
      [-0.02, -0.52, -0.9],
      [0.28, 0.01, 0.15],
      0xc5c4ab,
      this.arms,
    );
    this.tapeStrip.visible = false;
    this.box([0.53, -0.62, -0.2], [0.32, 0.42, 0.32], 0x526870, this.arms);
    this.box([0.53, -0.42, -0.34], [0.2, 0.03, 0.1], C.amber, this.arms);
  }
  makePod() {
    this.pod = new T.Group();
    this.world.add(this.pod);
    for (const y of [-0.85, 0.85])
      this.mesh(
        new T.CylinderGeometry(0.67, 0.67, 0.18, 16),
        this.mat(0xc3d0c9),
        [0, y, 0],
        this.pod,
      );
    this.mesh(
      new T.CylinderGeometry(0.62, 0.62, 1.7, 24, 1, true),
      this.mat(0x9fdfcd, {
        transparent: true,
        opacity: 0.14,
        side: T.DoubleSide,
        depthWrite: false,
        roughness: 0.1,
      }),
      [0, 0, 0],
      this.pod,
    );
    for (let i = 0; i < 4; i++) {
      const a = (i * Math.PI) / 2;
      this.rod(
        [Math.cos(a) * 0.63, -0.85, Math.sin(a) * 0.63],
        [Math.cos(a) * 0.63, 0.85, Math.sin(a) * 0.63],
        0.035,
        0x8faaa7,
        this.pod,
      );
    }
    this.rod([-0.3, 0, 0.8], [0.3, 0, 0.8], 0.055, C.amber, this.pod);
    this.rod([-0.3, 0, 0.6], [-0.3, 0, 0.8], 0.04, C.amber, this.pod);
    this.rod([0.3, 0, 0.6], [0.3, 0, 0.8], 0.04, C.amber, this.pod);
    this.mesh(
      new T.CylinderGeometry(0.38, 0.45, 0.22, 12),
      this.mat(0x314d3c),
      [0, -0.65, 0],
      this.pod,
    );
    this.rod([0, -0.6, 0], [0, 0.4, 0], 0.025, 0x719b52, this.pod);
    for (let i = 0; i < 8; i++) {
      const a = i * 2.4;
      const leaf = this.mesh(
        new T.SphereGeometry(0.16, 12, 8),
        this.mat(0x91c961, { emissive: 0x3b6821, emissiveIntensity: 0.45 }),
        [Math.cos(a) * 0.16, -0.38 + i * 0.09, Math.sin(a) * 0.16],
        this.pod,
      );
      leaf.scale.set(1.5, 0.2, 1);
      leaf.rotation.z = Math.sin(a) * 0.4;
    }
    for (let i = 0; i < 5; i++) {
      const a = i * Math.PI * 0.4;
      const petal = this.mesh(
        new T.SphereGeometry(0.12, 10, 8),
        this.mat(0xe6f6c1, { emissive: 0x829d43, emissiveIntensity: 0.6 }),
        [Math.cos(a) * 0.1, 0.42, Math.sin(a) * 0.1],
        this.pod,
      );
      petal.scale.set(1, 0.4, 1.6);
    }
    this.pod.add(new T.PointLight(0x91df84, 3, 4));
  }
  createMarkers() {
    document.getElementById("world-markers").replaceChildren();
    for (const data of [
      { id: "pod", name: "氧气花培养舱", kind: "pod" },
      ...ANCHORS.map((a) => ({
        id: a.id,
        name: a.name,
        p: anchorGrip(a),
        kind: "anchor",
      })),
      ...PACKS.map((p) => ({
        id: p.id,
        name: p.name,
        p: p.p,
        kind: p.optional ? "optional" : "pack",
      })),
    ]) {
      const el = document.createElement("div");
      el.className = "marker " + data.kind;
      el.innerHTML = '<div class="diamond"></div><span></span><small></small>';
      el.querySelector("span").textContent = data.name;
      document.getElementById("world-markers").append(el);
      this.markers.push({ ...data, el });
    }
  }
  resize() {
    const w = this.canvas.clientWidth,
      h = this.canvas.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }
  hit(time) {
    this.hitTime = time;
  }
  armLink(mesh, a, b) {
    const d = b.clone().sub(a);
    mesh.position.copy(a).add(b).multiplyScalar(0.5);
    mesh.scale.y = d.length();
    mesh.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), d.normalize());
  }
  render(s, options = {}) {
    this.camera.position.set(...s.p);
    this.camera.rotation.set(s.pitch, -s.yaw, 0, "YXZ");
    const shock = Math.max(0, 1 - (s.time - this.hitTime) * 2);
    if (shock > 0) {
      this.camera.position.x += Math.sin(s.time * 73) * 0.025 * shock;
      this.camera.position.y += Math.sin(s.time * 58) * 0.018 * shock;
    }
    this.camera.updateMatrixWorld(true);
    for (const r of s.rocks) {
      let m = this.rocks.get(r.id);
      if (!m) {
        m = this.mesh(
          new T.IcosahedronGeometry(r.r, 1),
          this.mat(0x8f8578, { flatShading: true }),
          r.p,
        );
        const band = new T.LineSegments(
          new T.WireframeGeometry(new T.IcosahedronGeometry(r.r * 1.015, 0)),
          new T.LineBasicMaterial({
            color: 0xd6ba87,
            transparent: true,
            opacity: 0.18,
          }),
        );
        m.add(band);
        this.rocks.set(r.id, m);
      }
      m.position.set(...r.p);
      m.rotation.set(s.time * 0.07, s.time * 0.04, 0);
    }
    this.meteors.forEach((m, i) => {
      m.position.set(...meteorPosition(METEORS[i], s.time, s.assist));
      m.rotation.set(s.time * 0.2 + i, s.time * 0.13, 0);
    });
    for (const [id, g] of this.packs) {
      g.visible = !s.collected.includes(id);
      if (id.includes("side")) g.rotation.y = s.time * 0.1;
    }
    this.pod.position.set(...podPosition(s.time));
    this.pod.rotation.y = Math.sin(s.time * 0.05) * 0.1;
    if (options.recovery) {
      const t = options.recovery;
      const end = new T.Vector3(1.5, 1, -106);
      this.pod.position.lerp(end, t * t * (3 - 2 * t));
      this.cable.visible = true;
      const line = [new T.Vector3(1.5, 0.8, -106), this.pod.position.clone()];
      this.cable.geometry.setFromPoints(line);
    } else this.cable.visible = false;
    const shoulder = new T.Vector3(0.46, -0.55, -0.08),
      idle = new T.Vector3(0.38, -0.37, -0.85);
    let hand = idle.clone();
    const contact =
      s.arm.kind === "push" ||
      s.arm.kind === "pickup" ||
      s.arm.kind === "capture";
    if (
      s.anchor ||
      (contact && s.arm.age < 0.9) ||
      (s.captured && s.arm.age < 1.8)
    ) {
      const a = ANCHORS.find((a) => a.id === s.anchor);
      const world = a ? anchorGrip(a) : s.arm.target;
      if (world) {
        const target = this.camera.worldToLocal(new T.Vector3(...world));
        target.clampLength(0, 2.4);
        const strength = s.anchor
          ? 1
          : s.captured
            ? Math.min(1, s.arm.age * 3)
            : Math.sin(Math.min(1, s.arm.age / 0.9) * Math.PI);
        hand.lerp(target, strength);
      }
    }
    if (s.repair > 0)
      hand.set(0.18 + Math.sin(s.repair * 12) * 0.025, -0.48, -0.92);
    const elbow = new T.Vector3(0.65, -0.42, -0.48).lerp(hand, 0.3);
    this.armLink(this.upper, shoulder, elbow);
    this.armLink(this.lower, elbow, hand);
    this.elbow.position.copy(elbow);
    this.wrist.position.copy(hand);
    this.wrist.rotation.set(0.1, s.anchor ? -0.3 : 0, 0);
    this.fingers.forEach((f, i) => {
      f.rotation.y = (i ? 1 : -1) * (s.anchor ? 0.32 : 0.06);
    });
    this.left.visible =
      s.repair > 0 || (s.arm.kind === "repair-done" && s.arm.age < 1.2);
    this.chest.visible = this.left.visible;
    this.left.position.set(-0.24 + Math.sin(s.repair * 6) * 0.08, -0.47, -0.9);
    this.left.rotation.z = -0.2;
    this.tapeStrip.visible =
      s.repair > 1.2 || (s.arm.kind === "repair-done" && s.arm.age < 1.2);
    for (const mark of this.markers) {
      const pos =
        mark.id === "pod" ? this.pod.position : new T.Vector3(...mark.p);
      const dist = pos.distanceTo(this.camera.position);
      const collected = s.collected.includes(mark.id);
      const visible =
        mark.kind === "pod" ||
        (mark.kind === "anchor" && dist < 22) ||
        (["pack", "optional"].includes(mark.kind) && dist < 15 && !collected);
      mark.el.hidden = !visible || options.recovery > 0;
      if (!visible) continue;
      const q = pos.clone().project(this.camera);
      const front =
        pos
          .clone()
          .sub(this.camera.position)
          .dot(this.camera.getWorldDirection(new T.Vector3())) > 0;
      let x = q.x,
        y = q.y,
        edge = false;
      if (!front || Math.abs(x) > 0.9 || Math.abs(y) > 0.8) {
        if (mark.kind !== "pod") {
          mark.el.hidden = true;
          continue;
        }
        edge = true;
        if (!front) {
          x = -x;
          y = -y;
        }
        const factor = Math.max(Math.abs(x) / 0.85, Math.abs(y) / 0.65, 1);
        x /= factor;
        y /= factor;
      }
      mark.el.classList.toggle("edge", edge);
      mark.el.style.left = (x * 0.5 + 0.5) * this.canvas.clientWidth + "px";
      mark.el.style.top = (-y * 0.5 + 0.5) * this.canvas.clientHeight + "px";
      mark.el.querySelector("small").textContent =
        (edge ? "↗ " : "") + Math.round(dist) + " m";
      mark.el.style.opacity =
        mark.kind === "pod" ? "1" : String(Math.min(1, (25 - dist) / 12));
    }
    this.renderer.render(this.scene, this.camera);
  }
}
