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
    new ResizeObserver(() => this.redimensionar()).observe(alvo);
    this.redimensionar();
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
  definirMalha(id: number, pos: Float32Array, tri: Uint32Array) {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setIndex(new THREE.BufferAttribute(tri, 1));
    g.computeVertexNormals();
    this.geos.get(id)?.dispose();
    this.geos.set(id, g);
  }

  /**
   * Cópias na mesa: cada uma com a malha da peça, na posição dada. `escolhida` fica mais escura;
   * `fora` (ids) em vermelho (não cabe ou passa da borda).
   */
  definirPecas(lista: { id: number; posicoes: [number, number][] }[], escolhida: number | null, fora: Set<number>) {
    for (const m of this.pecas.children) ((m as THREE.Mesh).material as THREE.Material).dispose();
    this.pecas.clear();
    for (const id of [...this.geos.keys()]) if (!lista.some((p) => p.id === id)) {
      this.geos.get(id)!.dispose();
      this.geos.delete(id);
    }
    for (const p of lista) {
      const g = this.geos.get(p.id);
      if (!g) continue;
      const cor = fora.has(p.id) ? COR_FORA : p.id === escolhida ? COR_ESCOLHIDA : COR;
      for (const [x, y] of p.posicoes) {
        const mat = new THREE.MeshStandardMaterial({ color: cor, roughness: 0.55, metalness: 0.05, clippingPlanes: [this.corte] });
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
      this.renderer.render(this.cena, this.camera);
    });
  }
}
