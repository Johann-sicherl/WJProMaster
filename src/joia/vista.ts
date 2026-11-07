// WJGoldDiamond: vista 3D (Three.js). Projeção ortográfica e tema claro, como no WJCAD; desenha
// só quando algo muda (ou enquanto gira). Metal com reflexos do ambiente e gemas com refração e
// dispersão. Mouse: esquerdo ou meio giram, direito desloca, roda aproxima; toque: 1 dedo gira,
// 2 dedos aproximam e deslocam.

import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { malhaGema } from "./malhaGema";
import { MATERIAIS, type GemaPosta } from "./regras";

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
    this.cena.add(this.metal, this.gemas);
    this.camera.position.set(30, 25, 40);
    this.controles = new OrbitControls(this.camera, this.renderer.domElement);
    this.controles.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.ROTATE, RIGHT: THREE.MOUSE.PAN };
    this.controles.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
    this.controles.zoomToCursor = true;
    this.controles.autoRotateSpeed = 4;
    this.controles.addEventListener("change", () => this.desenhar());
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
