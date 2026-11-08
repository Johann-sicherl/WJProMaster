// WJGoldDiamond: vista 3D (Three.js). Projeção ortográfica e tema claro, como no WJCAD; desenha
// só quando algo muda (ou enquanto gira). Metal com reflexos do ambiente e gemas com refração e
// dispersão. Mouse: esquerdo ou meio giram, direito desloca, roda aproxima; toque: 1 dedo gira,
// 2 dedos aproximam e deslocam.

import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { malhaGema } from "./malhaGema";
import { MATERIAIS, type GemaPosta, type V3 } from "./regras";

/** Escultura para a vista: geometria (arrays vivos durante o esculpir) e matrizes no mundo. */
export interface EsculturaVista { id: string; pos: Float32Array; nor: Float32Array; tri: Uint32Array; matrizes: number[][] }
/** Pincel: ponto e normal no espaço local da escultura; `d` = deslocamento local (arrastar). */
export type EventoPincel = { fase: "inicio" | "meio" | "fim"; id: string; c: V3; n: V3; pressao: number; d?: V3 };

export class VistaJoia {
  private renderer: THREE.WebGLRenderer;
  private cena = new THREE.Scene();
  private camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -1000, 1000);
  private controles: OrbitControls;
  private metal: THREE.Mesh;
  private gemas = new THREE.Group();
  private geoGemas = new Map<string, THREE.BufferGeometry>();
  private matGemas = new Map<string, THREE.MeshPhysicalMaterial>();
  private quadro = 0;
  private girando = false;
  private raio = 15;
  private esculturas = new THREE.Group();
  private geoEsc = new Map<string, THREE.BufferGeometry>();
  /** modo esculpir: id da escultura, raio do pincel (mm) e se o dedo esculpe */
  esculpir: { id: string; raio: number; dedo: boolean; aoPincel: (e: EventoPincel) => void } | null = null;
  private cursor: THREE.LineLoop;
  private traco: { id: string; plano: THREE.Plane; ultimo: THREE.Vector3; malha: THREE.Mesh; ponteiro: number } | null = null;

  constructor(private alvo: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: false });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setClearColor(0xf4f6f8);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    alvo.append(this.renderer.domElement);
    const pm = new THREE.PMREMGenerator(this.renderer);
    this.cena.environment = pm.fromScene(new RoomEnvironment(), 0.03).texture;
    pm.dispose();
    const sol = new THREE.DirectionalLight(0xffffff, 1.2);
    sol.position.set(20, 40, 30);
    this.cena.add(sol, new THREE.AmbientLight(0xffffff, 0.25));
    this.metal = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial({ color: 0xe3b85c, metalness: 1, roughness: 0.18 }));
    this.cena.add(this.metal, this.gemas, this.esculturas);
    const circ = new THREE.BufferGeometry().setFromPoints(Array.from({ length: 48 }, (_, i) => new THREE.Vector3(Math.cos((i / 48) * Math.PI * 2), Math.sin((i / 48) * Math.PI * 2), 0)));
    this.cursor = new THREE.LineLoop(circ, new THREE.LineBasicMaterial({ color: 0x2f7fd0, depthTest: false }));
    this.cursor.visible = false;
    this.cursor.renderOrder = 10;
    this.cena.add(this.cursor);
    this.camera.position.set(30, 25, 40);
    this.controles = new OrbitControls(this.camera, this.renderer.domElement);
    this.controles.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.ROTATE, RIGHT: THREE.MOUSE.PAN };
    this.controles.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
    this.controles.zoomToCursor = true;
    this.controles.autoRotateSpeed = 4;
    this.controles.addEventListener("change", () => this.desenhar());
    // pincel: captura antes dos controles (caneta e mouse esquerdo esculpem; o dedo navega, salvo "esculpir com o dedo")
    const cv = this.renderer.domElement;
    cv.addEventListener("pointerdown", (e) => this.inicioTraco(e), { capture: true });
    cv.addEventListener("pointermove", (e) => this.moverTraco(e), { capture: true });
    for (const t of ["pointerup", "pointercancel"] as const) cv.addEventListener(t, (e) => this.fimTraco(e), { capture: true });
    cv.addEventListener("pointerleave", () => { this.cursor.visible = false; this.desenhar(); });
    new ResizeObserver(() => this.redimensionar()).observe(alvo);
    this.redimensionar();
  }

  private redimensionar() {
    const w = Math.max(1, this.alvo.clientWidth), h = Math.max(1, this.alvo.clientHeight);
    this.renderer.setSize(w, h);
    const a = w / h, r = this.raio * 1.25;
    Object.assign(this.camera, { left: -r * a, right: r * a, top: r, bottom: -r });
    this.camera.updateProjectionMatrix();
    this.desenhar();
  }

  definirMetal(pos: Float32Array, nor: Float32Array, idx: Uint32Array, cor: string) {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.computeBoundingSphere();
    this.metal.geometry.dispose();
    this.metal.geometry = g;
    (this.metal.material as THREE.MeshStandardMaterial).color.set(cor);
    this.desenhar();
  }

  /** Esculturas (malhas separadas com o material do metal; a cópia espelhada usa a mesma geometria). */
  definirEsculturas(lista: EsculturaVista[]) {
    this.esculturas.clear();
    for (const g of this.geoEsc.values()) g.dispose();
    this.geoEsc.clear();
    for (const e of lista) {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(e.pos, 3));
      g.setAttribute("normal", new THREE.BufferAttribute(e.nor, 3));
      g.setIndex(new THREE.BufferAttribute(e.tri, 1));
      g.computeBoundingSphere();
      this.geoEsc.set(e.id, g);
      for (const M of e.matrizes) {
        const me = new THREE.Mesh(g, this.metal.material);
        me.matrixAutoUpdate = false;
        me.matrix.fromArray(M);
        me.userData.id = e.id;
        this.esculturas.add(me);
      }
    }
    this.esculturas.updateMatrixWorld(true);
    this.desenhar();
  }

  /** Posições/normais da escultura mudaram (durante o traço). */
  atualizarEscultura(id: string) {
    const g = this.geoEsc.get(id);
    if (!g) return;
    g.attributes.position.needsUpdate = true;
    g.attributes.normal.needsUpdate = true;
    g.computeBoundingSphere();
    g.computeBoundingBox();
    this.desenhar();
  }

  private raycaster = new THREE.Raycaster();
  private acertar(e: PointerEvent): THREE.Intersection | null {
    const r = this.renderer.domElement.getBoundingClientRect();
    this.raycaster.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), this.camera);
    const alvos = this.esculturas.children.filter((m) => m.userData.id === this.esculpir?.id);
    return this.raycaster.intersectObjects(alvos, false)[0] ?? null;
  }

  private local(h: THREE.Intersection): { c: V3; n: V3; malha: THREE.Mesh } {
    const malha = h.object as THREE.Mesh;
    const inv = malha.matrixWorld.clone().invert();
    const c = h.point.clone().applyMatrix4(inv);
    const n = h.face!.normal.clone();
    return { c: [c.x, c.y, c.z], n: [n.x, n.y, n.z], malha };
  }

  private mostrarCursor(h: THREE.Intersection | null) {
    if (!h || !this.esculpir) { this.cursor.visible = false; return this.desenhar(); }
    const nw = h.face!.normal.clone().transformDirection(h.object.matrixWorld);
    this.cursor.position.copy(h.point);
    this.cursor.lookAt(h.point.clone().add(nw));
    this.cursor.scale.setScalar(this.esculpir.raio);
    this.cursor.visible = true;
    this.desenhar();
  }

  private podeEsculpir(e: PointerEvent) {
    if (!this.esculpir) return false;
    if (e.pointerType === "pen") return true;
    if (e.pointerType === "mouse") return e.button === 0;
    return this.esculpir.dedo && e.isPrimary;
  }

  private inicioTraco(e: PointerEvent) {
    if (!this.podeEsculpir(e)) return;
    const h = this.acertar(e);
    if (!h) return;
    e.stopImmediatePropagation();
    e.preventDefault();
    this.renderer.domElement.setPointerCapture(e.pointerId);
    this.controles.enabled = false;
    const { c, n, malha } = this.local(h);
    const normalTela = this.camera.getWorldDirection(new THREE.Vector3()).negate();
    this.traco = { id: this.esculpir!.id, plano: new THREE.Plane().setFromNormalAndCoplanarPoint(normalTela, h.point), ultimo: h.point.clone(), malha, ponteiro: e.pointerId };
    this.esculpir!.aoPincel({ fase: "inicio", id: this.traco.id, c, n, pressao: e.pointerType === "mouse" ? 1 : e.pressure || 0.5 });
    this.mostrarCursor(h);
  }

  private moverTraco(e: PointerEvent) {
    if (!this.esculpir) return;
    if (!this.traco) {
      if (e.pointerType !== "touch") this.mostrarCursor(this.acertar(e));
      return;
    }
    if (e.pointerId !== this.traco.ponteiro) return;
    e.stopImmediatePropagation();
    const pressao = e.pointerType === "mouse" ? 1 : e.pressure || 0.5;
    // deslocamento no plano da tela (arrastar), levado ao espaço local
    const r = this.renderer.domElement.getBoundingClientRect();
    this.raycaster.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), this.camera);
    const p = new THREE.Vector3();
    const noPlano = this.raycaster.ray.intersectPlane(this.traco.plano, p);
    let d: V3 | undefined;
    if (noPlano) {
      const inv = this.traco.malha.matrixWorld.clone().invert();
      const a = this.traco.ultimo.clone().applyMatrix4(inv), b = p.clone().applyMatrix4(inv);
      d = [b.x - a.x, b.y - a.y, b.z - a.z];
      this.traco.ultimo.copy(p);
    }
    const h = this.acertar(e);
    if (h) {
      const { c, n } = this.local(h);
      this.esculpir.aoPincel({ fase: "meio", id: this.traco.id, c, n, pressao, d });
    } else if (d) this.esculpir.aoPincel({ fase: "meio", id: this.traco.id, c: [NaN, NaN, NaN], n: [0, 0, 0], pressao, d });
    this.mostrarCursor(h);
  }

  private fimTraco(e: PointerEvent) {
    if (!this.traco || e.pointerId !== this.traco.ponteiro) return;
    e.stopImmediatePropagation();
    const id = this.traco.id;
    this.traco = null;
    this.controles.enabled = true;
    this.esculpir?.aoPincel({ fase: "fim", id, c: [0, 0, 0], n: [0, 0, 0], pressao: 0 });
  }

  corMetal(cor: string) {
    (this.metal.material as THREE.MeshStandardMaterial).color.set(cor);
    this.desenhar();
  }

  definirGemas(lista: GemaPosta[]) {
    this.gemas.clear();
    for (const g of lista) {
      const x = g.gema;
      const kg = `${x.lapidacao}|${x.comprimento.toFixed(3)}|${x.largura.toFixed(3)}`;
      let geo = this.geoGemas.get(kg);
      if (!geo) {
        geo = new THREE.BufferGeometry();
        geo.setAttribute("position", new THREE.BufferAttribute(malhaGema(x), 3));
        geo.computeVertexNormals();
        this.geoGemas.set(kg, geo);
      }
      let mat = this.matGemas.get(x.material);
      if (!mat) {
        const m = MATERIAIS[x.material] ?? MATERIAIS.diamante;
        mat = new THREE.MeshPhysicalMaterial({
          color: m.cor, metalness: 0, roughness: 0, transmission: 1, ior: m.ior, thickness: 2, dispersion: m.dispersao * 60,
          specularIntensity: 1, envMapIntensity: 1.6, flatShading: true, side: THREE.DoubleSide,
        });
        this.matGemas.set(x.material, mat);
      }
      const me = new THREE.Mesh(geo, mat);
      me.rotation.set(0, g.ref.ry, g.ref.rz, "ZYX");
      me.position.set(...g.ref.p);
      this.gemas.add(me);
    }
    this.desenhar();
  }

  /** Ajusta o enquadramento ao tamanho da joia (raio aproximado em mm). */
  enquadrar(raio?: number) {
    if (raio) this.raio = raio;
    this.controles.target.set(0, this.raio * 0.15, 0);
    this.camera.zoom = 1;
    this.camera.updateProjectionMatrix();
    this.redimensionar();
    this.controles.update();
  }

  vista(nome: "frente" | "lado" | "cima" | "iso") {
    const d = 60;
    const p = { frente: [0, 0, d], lado: [d, 0, 0], cima: [0, d, 0.001], iso: [d * 0.6, d * 0.5, d * 0.65] }[nome];
    this.camera.position.set(p[0], p[1] + this.controles.target.y, p[2]);
    this.camera.up.set(0, 1, 0);
    this.controles.update();
    this.desenhar();
  }

  girar(sim: boolean) {
    this.girando = sim;
    this.controles.autoRotate = sim;
    const passo = () => {
      if (!this.girando) return;
      this.controles.update();
      this.renderer.render(this.cena, this.camera);
      requestAnimationFrame(passo);
    };
    if (sim) requestAnimationFrame(passo);
  }

  get estaGirando() {
    return this.girando;
  }

  desenhar() {
    if (this.quadro || this.girando) return;
    this.quadro = requestAnimationFrame(() => {
      this.quadro = 0;
      this.renderer.render(this.cena, this.camera);
    });
  }

  /** Imagem PNG da vista atual (o dobro da resolução da tela). */
  imagem(): Promise<Blob | null> {
    const px = this.renderer.getPixelRatio();
    this.renderer.setPixelRatio(Math.min(4, px * 2));
    this.redimensionar();
    this.renderer.render(this.cena, this.camera);
    return new Promise((ok) => this.renderer.domElement.toBlob((b) => {
      this.renderer.setPixelRatio(px);
      this.redimensionar();
      ok(b);
    }, "image/png"));
  }
}
