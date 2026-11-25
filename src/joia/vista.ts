// WJGoldDiamond: vista 3D (Three.js). Projeção ortográfica e tema claro, como no WJCAD; desenha
// só quando algo muda (ou enquanto gira). Metal com reflexos do ambiente e gemas com refração e
// dispersão. Mouse: esquerdo ou meio giram, direito desloca, roda aproxima; toque: 1 dedo gira,
// 2 dedos aproximam e deslocam.

import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { malhaGema } from "./malhaGema";
import { MATERIAIS, type GemaPosta, type V3 } from "./regras";
import { campoVisao, cantosNoMundo, type Camera as CameraFoto, type RefFoto } from "./referencia";

/** Escultura para a vista: geometria (arrays vivos durante o esculpir) e matrizes no mundo. */
export interface EsculturaVista { id: string; pos: Float32Array; nor: Float32Array; tri: Uint32Array; matrizes: number[][] }
/** Pincel: ponto e normal no espaço local da escultura; `d` = deslocamento local (arrastar). */
export type EventoPincel = { fase: "inicio" | "meio" | "fim"; id: string; c: V3; n: V3; pressao: number; d?: V3 };
/** Toque/clique curto na vista (caneta, dedo ou mouse): gema livre tocada e/ou ponto da superfície do metal. */
export type ToqueVista = { livre?: string; ponto?: V3; tipo: string; /** px no canvas */ tela?: [number, number] };

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
  /** toque curto fora do esculpir: seleciona gema livre ou posiciona sobre a superfície */
  aoTocar: ((t: ToqueVista) => void) | null = null;
  private toques = new Map<number, { x: number; y: number; t: number }>();
  private multiToque = false;
  private destaque = new THREE.Group();
  private idDestaque = "";
  // imagem de referência: plano na vista (modo vista) ou fundo/frente com a câmera da foto (modo câmera)
  private fotoPlano: THREE.Mesh | null = null;
  private fotoTextura: THREE.Texture | null = null;
  private fotoChave = "";
  private fotoCena = new THREE.Scene();
  private fotoCam = new THREE.OrthographicCamera(-1, 1, 1, -1, -1, 1);
  private fotoQuad: THREE.Mesh;
  private camFoto: THREE.PerspectiveCamera | null = null;
  private refFoto: RefFoto | null = null;
  /** mistura do "comparar" (0 = só modelo, 1 = só foto); null = sem comparar */
  private mistura: number | null = null;

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
    // toque curto (< 8 px, < 0,6 s, um ponteiro só): não briga com girar/aproximar
    cv.addEventListener("pointerdown", (e) => {
      if (this.esculpir) return;
      this.toques.set(e.pointerId, { x: e.clientX, y: e.clientY, t: performance.now() });
      if (this.toques.size > 1) this.multiToque = true;
    });
    cv.addEventListener("pointerup", (e) => {
      const t0 = this.toques.get(e.pointerId);
      this.toques.delete(e.pointerId);
      const multi = this.multiToque;
      if (!this.toques.size) this.multiToque = false;
      if (!t0 || multi || this.esculpir || (e.pointerType === "mouse" && e.button !== 0)) return;
      if (Math.hypot(e.clientX - t0.x, e.clientY - t0.y) > 8 || performance.now() - t0.t > 600) return;
      this.tocar(e);
    });
    cv.addEventListener("pointercancel", (e) => { this.toques.delete(e.pointerId); if (!this.toques.size) this.multiToque = false; });
    this.cena.add(this.destaque);
    this.fotoQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.MeshBasicMaterial({ transparent: true, depthTest: false, depthWrite: false, toneMapped: false }));
    this.fotoCena.add(this.fotoQuad);
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

  private tocar(e: PointerEvent) {
    if (!this.aoTocar) return;
    const r = this.renderer.domElement.getBoundingClientRect();
    const ret = this.camFoto && this.refFoto ? this.retanguloFoto()! : { x: 0, y: 0, w: r.width, h: r.height };
    const x = e.clientX - r.left - ret.x, y = e.clientY - r.top - ret.y;
    this.raycaster.setFromCamera(new THREE.Vector2((x / ret.w) * 2 - 1, -(y / ret.h) * 2 + 1), this.camFoto && this.refFoto ? this.camFoto : this.camera);
    const g = this.raycaster.intersectObjects(this.gemas.children, false).find((h) => h.object.userData.livre);
    const s = this.raycaster.intersectObjects([this.metal, ...this.esculturas.children], false)[0];
    const t: ToqueVista = { tipo: e.pointerType };
    if (g && (!s || g.distance <= s.distance + 0.05)) t.livre = g.object.userData.livre as string;
    if (s) t.ponto = [s.point.x, s.point.y, s.point.z];
    t.tela = [e.clientX - r.left, e.clientY - r.top];
    this.aoTocar(t);
  }

  /** Contorno azul nas cópias da gema livre selecionada ("" = nenhuma). */
  destacar(id: string) {
    this.idDestaque = id;
    for (const c of this.destaque.children) (c as THREE.LineSegments).geometry.dispose();
    this.destaque.clear();
    if (id) for (const me of this.gemas.children as THREE.Mesh[]) {
      if (me.userData.livre !== id) continue;
      const l = new THREE.LineSegments(new THREE.EdgesGeometry(me.geometry, 25), new THREE.LineBasicMaterial({ color: 0x2f7fd0, depthTest: false }));
      l.renderOrder = 9;
      l.matrixAutoUpdate = false;
      me.updateMatrix();
      l.matrix.copy(me.matrix);
      this.destaque.add(l);
    }
    this.desenhar();
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
    // Toque sintético (ou ponteiro já solto) não tem captura ativa: segue sem capturar.
    try { this.renderer.domElement.setPointerCapture(e.pointerId); } catch { /* sem ponteiro ativo */ }
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

  /** Gemas na vista; `livres[i]` = id da gema livre (para tocar e destacar). */
  definirGemas(lista: GemaPosta[], livres: (string | undefined)[] = []) {
    this.gemas.clear();
    for (const [i, g] of lista.entries()) {
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
      if (g.ref.m) {
        const M = g.ref.m;
        me.quaternion.setFromRotationMatrix(new THREE.Matrix4().set(M[0], M[1], M[2], 0, M[3], M[4], M[5], 0, M[6], M[7], M[8], 0, 0, 0, 0, 1));
      } else me.rotation.set(0, g.ref.ry, g.ref.rz, "ZYX");
      me.position.set(...g.ref.p);
      if (livres[i]) me.userData.livre = livres[i];
      this.gemas.add(me);
    }
    this.gemas.updateMatrixWorld(true);
    this.destacar(this.idDestaque);
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
      this.render();
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
      this.render();
    });
  }

  /** Retângulo (px do canvas) onde a foto aparece inteira (modo câmera). */
  retanguloFoto(): { x: number; y: number; w: number; h: number } | null {
    const r = this.refFoto;
    if (!r) return null;
    const W = this.renderer.domElement.clientWidth, H = this.renderer.domElement.clientHeight;
    const k = Math.min(W / r.largura, H / r.altura);
    return { x: (W - r.largura * k) / 2, y: (H - r.altura * k) / 2, w: r.largura * k, h: r.altura * k };
  }

  private render() {
    const r = this.refFoto, ren = this.renderer;
    const cam = this.camFoto && r ? this.camFoto : this.camera;
    const misturar = this.mistura !== null;
    // modo câmera: a vista fica do tamanho e proporção da foto (faixas nas bordas)
    const ret = this.camFoto && r ? this.retanguloFoto() : null;
    const W = ren.domElement.clientWidth, H = ren.domElement.clientHeight;
    ren.autoClear = false;
    ren.setScissorTest(false);
    ren.setViewport(0, 0, W, H);
    ren.clear();
    if (ret) {
      ren.setViewport(ret.x, H - ret.y - ret.h, ret.w, ret.h);
      ren.setScissor(ret.x, H - ret.y - ret.h, ret.w, ret.h);
      ren.setScissorTest(true);
    }
    const quad = this.fotoQuad.material as THREE.MeshBasicMaterial;
    const fundo = !!ret && !!this.fotoTextura && r!.ativo && !r!.frente && !misturar;
    const frente = !!ret && !!this.fotoTextura && r!.ativo && (r!.frente || misturar);
    if (fundo) { quad.opacity = 1; ren.render(this.fotoCena, this.fotoCam); ren.clearDepth(); }
    if (!(misturar && this.mistura! >= 0.999)) ren.render(this.cena, cam);
    if (frente) { quad.opacity = misturar ? this.mistura! : r!.opacidade; ren.render(this.fotoCena, this.fotoCam); }
    ren.setScissorTest(false);
  }

  /**
   * Imagem de referência: no modo vista, plano texturizado no plano da vista que passa por `ponto` (por trás:
   * 40 mm atrás; por cima: semitransparente sobre o modelo). No modo câmera com `usarCamera`, a vista passa a
   * ser a câmera em perspectiva da foto (só nesse modo) e a foto vai de fundo ou por cima.
   */
  definirFoto(r: RefFoto | null, ponto: V3, usarCamera: boolean) {
    this.refFoto = r && r.ativo ? r : null;
    if (this.fotoPlano) { this.cena.remove(this.fotoPlano); this.fotoPlano.geometry.dispose(); (this.fotoPlano.material as THREE.Material).dispose(); this.fotoPlano = null; }
    if (!r) {
      this.fotoTextura?.dispose();
      this.fotoTextura = null;
      this.fotoChave = "";
      this.usarCameraFoto(null);
      return this.desenhar();
    }
    const chave = r.imagem.slice(-64) + r.imagem.length;
    if (chave !== this.fotoChave) {
      this.fotoTextura?.dispose();
      this.fotoChave = chave;
      const img = new Image();
      const tex = new THREE.Texture(img);
      tex.colorSpace = THREE.SRGBColorSpace;
      img.onload = () => { tex.needsUpdate = true; this.desenhar(); };
      img.src = r.imagem;
      this.fotoTextura = tex;
    }
    (this.fotoQuad.material as THREE.MeshBasicMaterial).map = this.fotoTextura;
    (this.fotoQuad.material as THREE.MeshBasicMaterial).needsUpdate = true;
    if (r.ativo && r.modo === "vista") {
      const c = cantosNoMundo(r, ponto, r.frente ? -2 : 40);
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(new Float32Array([...c[3], ...c[2], ...c[1], ...c[0]]), 3));
      g.setAttribute("uv", new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), 2));
      g.setIndex([0, 1, 2, 0, 2, 3]);
      const mat = new THREE.MeshBasicMaterial({ map: this.fotoTextura, transparent: true, opacity: r.frente ? r.opacidade : 1, side: THREE.DoubleSide, depthTest: !r.frente, depthWrite: false, toneMapped: false });
      this.fotoPlano = new THREE.Mesh(g, mat);
      this.fotoPlano.renderOrder = r.frente ? 20 : -1;
      this.cena.add(this.fotoPlano);
    }
    this.usarCameraFoto(r.ativo && r.modo === "camera" && usarCamera && r.camera ? r.camera : null);
    this.desenhar();
  }

  /** Câmera da foto (perspectiva) ou volta à vista ortográfica de sempre. Os controles param enquanto ela vale. */
  private usarCameraFoto(c: CameraFoto | null) {
    if (!c || !this.refFoto) {
      if (this.camFoto) { this.camFoto = null; this.controles.enabled = true; }
      return;
    }
    const r = this.refFoto;
    const cam = (this.camFoto ??= new THREE.PerspectiveCamera(30, 1, 0.1, 2000));
    cam.fov = campoVisao(c, r.altura);
    cam.aspect = r.largura / r.altura;
    cam.position.set(...c.pos);
    const R = c.rot;
    // linhas de rot = eixos da câmera (direita, cima, trás) no mundo = colunas da rotação câmera → mundo
    cam.quaternion.setFromRotationMatrix(new THREE.Matrix4().set(R[0], R[3], R[6], 0, R[1], R[4], R[7], 0, R[2], R[5], R[8], 0, 0, 0, 0, 1));
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld(true);
    this.controles.enabled = false;
  }

  get cameraDaFoto(): boolean {
    return !!this.camFoto;
  }

  /** Comparar modelo × foto: mistura 0 (só modelo) a 1 (só foto); null desliga. */
  comparar(m: number | null) {
    this.mistura = m;
    if (this.fotoPlano) {
      const mat = this.fotoPlano.material as THREE.MeshBasicMaterial;
      if (m !== null) { mat.opacity = m; mat.depthTest = false; this.fotoPlano.renderOrder = 20; this.metal.visible = this.gemas.visible = m < 0.999; }
      else if (this.refFoto) { mat.opacity = this.refFoto.frente ? this.refFoto.opacidade : 1; mat.depthTest = !this.refFoto.frente; this.fotoPlano.renderOrder = this.refFoto.frente ? 20 : -1; this.metal.visible = this.gemas.visible = true; }
      mat.needsUpdate = true;
    } else this.metal.visible = this.gemas.visible = true;
    this.desenhar();
  }

  /** Câmera atual da vista no formato da foto (para partir dela ao alinhar com 2 pares). */
  cameraAtual(H: number): CameraFoto {
    const c = this.camera, e = c.matrixWorld.elements, t = this.controles.target;
    // ortográfica → perspectiva equivalente: 200 mm atrás, foco que dá o mesmo tamanho aparente no alvo
    const tras: V3 = [e[8], e[9], e[10]], dist = 200;
    const D = (c.position.x - t.x) * tras[0] + (c.position.y - t.y) * tras[1] + (c.position.z - t.z) * tras[2] + dist;
    const altura = (c.top - c.bottom) / c.zoom;
    return { pos: [c.position.x + tras[0] * dist, c.position.y + tras[1] * dist, c.position.z + tras[2] * dist], rot: [e[0], e[1], e[2], e[4], e[5], e[6], e[8], e[9], e[10]], f: (H * D) / altura };
  }

  /** Ponto do mundo → pixel do canvas (para os testes e a marcação). */
  naTela(p: V3): [number, number] {
    const cam = this.camFoto && this.refFoto ? this.camFoto : this.camera;
    const v = new THREE.Vector3(...p).project(cam);
    const ret = this.camFoto && this.refFoto ? this.retanguloFoto()! : { x: 0, y: 0, w: this.renderer.domElement.clientWidth, h: this.renderer.domElement.clientHeight };
    return [ret.x + ((v.x + 1) / 2) * ret.w, ret.y + ((1 - v.y) / 2) * ret.h];
  }

  /** Render em perspectiva por uma câmera dada (foto de teste gerada pelo próprio app; roteiros de interface). */
  fotoDeTeste(c: CameraFoto, W: number, H: number): string {
    const cam = new THREE.PerspectiveCamera(campoVisao(c, H), W / H, 0.1, 2000);
    cam.position.set(...c.pos);
    const R = c.rot;
    cam.quaternion.setFromRotationMatrix(new THREE.Matrix4().set(R[0], R[3], R[6], 0, R[1], R[4], R[7], 0, R[2], R[5], R[8], 0, 0, 0, 0, 1));
    cam.updateMatrixWorld(true);
    const px = this.renderer.getPixelRatio(), alvo = new THREE.Vector2();
    this.renderer.getSize(alvo);
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(W, H, false);
    this.renderer.setViewport(0, 0, W, H);
    this.renderer.setScissorTest(false);
    this.renderer.clear();
    this.renderer.render(this.cena, cam);
    const url = this.renderer.domElement.toDataURL("image/jpeg", 0.92);
    this.renderer.setPixelRatio(px);
    this.renderer.setSize(alvo.x, alvo.y);
    this.redimensionar();
    return url;
  }

  /** Esculturas visíveis (a joia final já as traz unidas). */
  mostrarEsculturas(v: boolean) {
    if (this.esculturas.visible !== v) { this.esculturas.visible = v; this.desenhar(); }
  }

  /** Imagem PNG da vista atual (o dobro da resolução da tela). */
  imagem(): Promise<Blob | null> {
    const px = this.renderer.getPixelRatio();
    this.renderer.setPixelRatio(Math.min(4, px * 2));
    this.redimensionar();
    this.render();
    return new Promise((ok) => this.renderer.domElement.toBlob((b) => {
      this.renderer.setPixelRatio(px);
      this.redimensionar();
      ok(b);
    }, "image/png"));
  }
}
