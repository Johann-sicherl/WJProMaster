// WJSlicer3D: vista 3D da mesa com as peças (Three.js). Projeção ortográfica e tema claro, como no
// resto do WJProMaster; desenha só quando algo muda. Coordenadas de impressão (Z para cima) viram
// as da tela (Y para cima). Mouse: esquerdo ou meio giram, direito desloca, roda aproxima no cursor;
// toque: 1 dedo gira, 2 dedos aproximam e deslocam; tocar numa peça a escolhe.
// Prévia das camadas: os caminhos da camada coloridos por tipo, as peças cortadas na altura dela.

import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

const COR = 0x2f7fd0, COR_ESCOLHIDA = 0x1d5fa6, COR_FORA = 0xc9372c;

export class VistaMesa {
  private renderer: THREE.WebGLRenderer;
  private cena = new THREE.Scene();
  private camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -5000, 5000);
  private controles: OrbitControls;
  /** grupo em coordenadas de impressão (Z para cima), girado para a tela */
  private mundo = new THREE.Group();
  private pecas = new THREE.Group();
  private mesa = new THREE.Group();
  private caminhos: THREE.LineSegments | null = null;
  private geos = new Map<number, THREE.BufferGeometry>();
  /** corte na altura da camada: os planos de corte ficam nas coordenadas do mundo (Y para cima) */
  private corte = new THREE.Plane(new THREE.Vector3(0, -1, 0), 1e6);
  private raio = 120;
  private quadro = 0;
  /** toque numa peça (id) ou no vazio (null) */
  aoEscolher: (id: number | null) => void = () => {};
  /** modo pintura: caneta (ou botão esquerdo do mouse) pinta; o dedo continua girando e aproximando */
  pintando = false;
  /** raio do pincel (mm), mostrado como esfera sob a caneta quando `mostrarPincel` */
  raioPincel = 3;
  mostrarPincel = true;
  aoPintar: (a: { fase: "inicio" | "mover" | "fim"; id: number; tri: number; ponto: [number, number, number]; normal: [number, number, number] }) => void = () => {};
  /** cor (0–3) de cada triângulo por peça e as cores dos filamentos (r, g, b de 0 a 1) */
  private cores = new Map<number, Uint8Array>();
  private sujas = new Set<number>();
  private paleta: [number, number, number][] = [[0.55, 0.6, 0.65], [0.85, 0.23, 0.17], [0.18, 0.44, 0.82], [0.91, 0.73, 0.14]];
  private cursor: THREE.Mesh;

  constructor(private alvo: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setClearColor(0xf4f6f8);
    this.renderer.localClippingEnabled = true;
    alvo.append(this.renderer.domElement);
    const sol = new THREE.DirectionalLight(0xffffff, 1.6);
    sol.position.set(0.5, 1, 0.7);
    const contra = new THREE.DirectionalLight(0xffffff, 0.5);
    contra.position.set(-0.6, 0.3, -0.8);
    this.cena.add(sol, contra, new THREE.AmbientLight(0xffffff, 0.55));
    this.cursor = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35, depthTest: false }));
    this.cursor.visible = false;
    this.cursor.renderOrder = 10;
    this.cena.add(this.cursor);
    this.mundo.rotation.x = -Math.PI / 2;
    this.mundo.add(this.mesa, this.pecas);
    this.cena.add(this.mundo);
    this.camera.position.set(220, 180, 260);
    this.controles = new OrbitControls(this.camera, this.renderer.domElement);
    this.controles.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.ROTATE, RIGHT: THREE.MOUSE.PAN };
    this.controles.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
    this.controles.zoomToCursor = true;
    this.controles.addEventListener("change", () => this.desenhar());
    // toque/clique sem arrastar escolhe a peça
    const tela = this.renderer.domElement;
    let ini: [number, number] | null = null;
    tela.addEventListener("pointerdown", (e) => (ini = e.isPrimary ? [e.clientX, e.clientY] : null));
    tela.addEventListener("pointerup", (e) => {
      if (!ini || Math.hypot(e.clientX - ini[0], e.clientY - ini[1]) > 6) return;
      ini = null;
      const r = tela.getBoundingClientRect();
      const ray = new THREE.Raycaster();
      ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), this.camera);
      const hit = ray.intersectObjects(this.pecas.children, false)[0];
      this.aoEscolher(hit ? (hit.object.userData.id as number) : null);
    });
    this.ligarPintura(alvo);
    new ResizeObserver(() => this.redimensionar()).observe(alvo);
    this.redimensionar();
  }

  /** Caneta e mouse pintam (antes de o OrbitControls ver o toque); dedo e botões do meio e direito seguem navegando. */
  private ligarPintura(alvo: HTMLElement) {
    let traco: number | null = null;
    let ultimoHover = 0;
    const tocar = (e: PointerEvent) => {
      const r = this.renderer.domElement.getBoundingClientRect();
      const ray = new THREE.Raycaster();
      ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), this.camera);
      const hit = ray.intersectObjects(this.pecas.children, false)[0];
      if (!hit || hit.faceIndex == null || !hit.face) return null;
      const ponto = hit.object.worldToLocal(hit.point.clone());
      return { id: hit.object.userData.id as number, tri: hit.faceIndex, ponto: [ponto.x, ponto.y, ponto.z] as [number, number, number], normal: [hit.face.normal.x, hit.face.normal.y, hit.face.normal.z] as [number, number, number], mundo: hit.point };
    };
    const pinta = (e: PointerEvent, fase: "inicio" | "mover") => {
      const h = tocar(e);
      this.moverCursor(h?.mundo ?? null);
      if (h) this.aoPintar({ fase, id: h.id, tri: h.tri, ponto: h.ponto, normal: h.normal });
    };
    alvo.addEventListener("pointerdown", (e) => {
      if (!this.pintando || e.pointerType === "touch" || (e.pointerType === "mouse" && e.button !== 0)) return;
      e.stopPropagation();
      e.preventDefault();
      traco = e.pointerId;
      try {
        alvo.setPointerCapture(e.pointerId);
      } catch {
        /* ponteiro sintético: segue sem captura */
      }
      pinta(e, "inicio");
    }, true);
    alvo.addEventListener("pointermove", (e) => {
      if (!this.pintando || e.pointerType === "touch") return;
      if (traco === e.pointerId) {
        e.stopPropagation();
        const lista = e.getCoalescedEvents?.() ?? [];
        const usar = lista.length > 1 ? lista.filter((_, k) => k % Math.ceil(lista.length / 6) === 0 || k === lista.length - 1) : [e];
        for (const q of usar) pinta(q, "mover");
      } else if (this.mostrarPincel && e.buttons === 0 && performance.now() - ultimoHover > 33) {
        ultimoHover = performance.now();
        this.moverCursor(tocar(e)?.mundo ?? null);
      }
    }, true);
    const fim = (e: PointerEvent) => {
      if (traco !== e.pointerId) return;
      e.stopPropagation();
      traco = null;
      this.aoPintar({ fase: "fim", id: 0, tri: 0, ponto: [0, 0, 0], normal: [0, 0, 1] });
    };
    alvo.addEventListener("pointerup", fim, true);
    alvo.addEventListener("pointercancel", fim, true);
    alvo.addEventListener("pointerleave", () => this.moverCursor(null), true);
  }

  moverCursor(p: THREE.Vector3 | null) {
    const ver = !!p && this.pintando && this.mostrarPincel;
    this.cursor.visible = ver;
    if (p && ver) {
      this.cursor.position.copy(p);
      this.cursor.scale.setScalar(Math.max(0.2, this.raioPincel));
    }
    this.desenhar();
  }

  /** Cores dos filamentos ("#rrggbb"), na ordem das cores pintadas. */
  definirFilamentos(hex: string[]) {
    this.paleta = hex.map((h) => {
      const c = new THREE.Color(h);
      return [c.r, c.g, c.b] as [number, number, number];
    });
    for (const id of this.cores.keys()) this.sujas.add(id);
    this.desenhar();
  }

  /** Muda a pintura de uma peça (a malha já está na vista). */
  definirCores(id: number, cores: Uint8Array) {
    this.cores.set(id, cores);
    this.sujas.add(id);
    this.desenhar();
  }

  private recolorir(id: number) {
    const g = this.geos.get(id), c = this.cores.get(id);
    if (!g || !c) return;
    const a = g.getAttribute("color") as THREE.BufferAttribute;
    const d = a.array as Float32Array;
    for (let t = 0; t < c.length; t++) {
      const [r, gg, b] = this.paleta[c[t]] ?? this.paleta[0];
      for (let k = 0; k < 3; k++) {
        d[t * 9 + k * 3] = r;
        d[t * 9 + k * 3 + 1] = gg;
        d[t * 9 + k * 3 + 2] = b;
      }
    }
    a.needsUpdate = true;
  }

  /** Mesa da máquina (mm), centrada na origem, com grade de 10 mm e borda. */
  definirMesa(largura: number, profundidade: number) {
    this.mesa.clear();
    const placa = new THREE.Mesh(new THREE.PlaneGeometry(largura, profundidade), new THREE.MeshStandardMaterial({ color: 0xdfe5eb, roughness: 0.9 }));
    placa.position.z = -0.05;
    const pontos: number[] = [];
    for (let x = -largura / 2; x <= largura / 2 + 1e-6; x += 10) pontos.push(x, -profundidade / 2, 0, x, profundidade / 2, 0);
    for (let y = -profundidade / 2; y <= profundidade / 2 + 1e-6; y += 10) pontos.push(-largura / 2, y, 0, largura / 2, y, 0);
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pontos, 3));
    const grade = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0xb9c2cc }));
    const b = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-largura / 2, -profundidade / 2, 0), new THREE.Vector3(largura / 2, -profundidade / 2, 0),
      new THREE.Vector3(largura / 2, profundidade / 2, 0), new THREE.Vector3(-largura / 2, profundidade / 2, 0),
    ]);
    const borda = new THREE.LineLoop(b, new THREE.LineBasicMaterial({ color: 0x5e6b78 }));
    this.mesa.add(placa, grade, borda);
    this.raio = Math.hypot(largura, profundidade) / 2;
    this.redimensionar();
  }

  /** Malha de uma peça (coordenadas de impressão, centrada). */
  definirMalha(id: number, pos: Float32Array, tri: Uint32Array, cores: Uint8Array) {
    // sem índice: cada triângulo tem as suas cores (pintura) e o índice do triângulo tocado é o da lista
    const n = tri.length / 3, p = new Float32Array(n * 9);
    for (let t = 0; t < n; t++)
      for (let k = 0; k < 3; k++) {
        const v = tri[t * 3 + k] * 3;
        p[t * 9 + k * 3] = pos[v];
        p[t * 9 + k * 3 + 1] = pos[v + 1];
        p[t * 9 + k * 3 + 2] = pos[v + 2];
      }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(p, 3));
    g.setAttribute("color", new THREE.BufferAttribute(new Float32Array(n * 9), 3));
    g.computeVertexNormals();
    this.geos.get(id)?.dispose();
    this.geos.set(id, g);
    this.cores.set(id, cores);
    this.recolorir(id);
  }

  /**
   * Cópias na mesa: cada uma com a malha da peça, na posição dada. `escolhida` fica mais escura;
   * `fora` (ids) em vermelho (não cabe ou passa da borda).
   */
  definirPecas(lista: { id: number; posicoes: [number, number][] }[], escolhida: number | null, fora: Set<number>, coloridas: Set<number> = new Set()) {
    for (const m of this.pecas.children) ((m as THREE.Mesh).material as THREE.Material).dispose();
    this.pecas.clear();
    for (const id of [...this.geos.keys()]) if (!lista.some((p) => p.id === id)) {
      this.geos.get(id)!.dispose();
      this.geos.delete(id);
      this.cores.delete(id);
    }
    for (const p of lista) {
      const g = this.geos.get(p.id);
      if (!g) continue;
      const colorida = coloridas.has(p.id);
      // peça pintada mostra as cores dos filamentos; a vermelha (fora da mesa) e a escolhida só ganham um tom
      const cor = colorida ? (fora.has(p.id) ? 0xff9a90 : 0xffffff) : fora.has(p.id) ? COR_FORA : p.id === escolhida ? COR_ESCOLHIDA : COR;
      for (const [x, y] of p.posicoes) {
        const mat = new THREE.MeshStandardMaterial({ color: cor, vertexColors: colorida, roughness: 0.55, metalness: 0.05, clippingPlanes: [this.corte] });
        if (colorida && p.id === escolhida) {
          mat.emissive.setHex(0x1d5fa6);
          mat.emissiveIntensity = 0.12;
        }
        const m = new THREE.Mesh(g, mat);
        m.position.set(x, y, 0);
        m.userData.id = p.id;
        this.pecas.add(m);
      }
    }
    this.desenhar();
  }

  /**
   * Prévia de uma camada: segmentos (x1, y1, x2, y2 …) na altura `z`, cor de cada parte; as peças
   * aparecem cortadas na camada e claras. `null` volta à vista normal.
   */
  mostrarCamada(c: { z: number; seg: Float32Array; parte: Uint8Array; cores: number[] } | null) {
    if (this.caminhos) {
      this.caminhos.geometry.dispose();
      (this.caminhos.material as THREE.Material).dispose();
      this.mundo.remove(this.caminhos);
      this.caminhos = null;
    }
    this.corte.constant = c ? c.z - 0.1 : 1e6;
    for (const m of this.pecas.children) {
      const mat = (m as THREE.Mesh).material as THREE.MeshStandardMaterial;
      mat.transparent = !!c;
      mat.opacity = c ? 0.35 : 1;
    }
    if (c) {
      const n = c.parte.length;
      const pos = new Float32Array(n * 6), cor = new Float32Array(n * 6);
      const tmp = new THREE.Color();
      for (let k = 0; k < n; k++) {
        pos.set([c.seg[k * 4], c.seg[k * 4 + 1], c.z, c.seg[k * 4 + 2], c.seg[k * 4 + 3], c.z], k * 6);
        tmp.setHex(c.cores[c.parte[k]] ?? 0x888888);
        cor.set([tmp.r, tmp.g, tmp.b, tmp.r, tmp.g, tmp.b], k * 6);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      g.setAttribute("color", new THREE.BufferAttribute(cor, 3));
      this.caminhos = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ vertexColors: true }));
      this.mundo.add(this.caminhos);
    }
    this.desenhar();
  }

  /** Vista isométrica de toda a mesa. */
  enquadrar() {
    this.controles.target.set(0, 0, 0);
    const d = this.raio * 2;
    this.camera.position.set(d * 0.7, d * 0.6, d * 0.9);
    this.camera.zoom = 1;
    this.camera.updateProjectionMatrix();
    this.controles.update();
    this.desenhar();
  }

  private redimensionar() {
    const w = Math.max(1, this.alvo.clientWidth), h = Math.max(1, this.alvo.clientHeight);
    this.renderer.setSize(w, h);
    const a = w / h, r = this.raio * 1.15;
    Object.assign(this.camera, a >= 1 ? { left: -r * a, right: r * a, top: r, bottom: -r } : { left: -r, right: r, top: r / a, bottom: -r / a });
    this.camera.updateProjectionMatrix();
    this.desenhar();
  }

  desenhar() {
    if (this.quadro) return;
    this.quadro = requestAnimationFrame(() => {
      this.quadro = 0;
      for (const id of this.sujas) this.recolorir(id);
      this.sujas.clear();
      this.renderer.render(this.cena, this.camera);
    });
  }
}
