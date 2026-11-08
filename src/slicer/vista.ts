// WJSlicer3D: vista 3D da mesa com a peça (Three.js). Projeção ortográfica e tema claro, como no
// resto do WJProMaster; desenha só quando algo muda. Coordenadas de impressão (Z para cima) viram
// as da tela (Y para cima). Mouse: esquerdo ou meio giram, direito desloca, roda aproxima no cursor;
// toque: 1 dedo gira, 2 dedos aproximam e deslocam.

import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

export class VistaMesa {
  private renderer: THREE.WebGLRenderer;
  private cena = new THREE.Scene();
  private camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -5000, 5000);
  private controles: OrbitControls;
  /** grupo em coordenadas de impressão (Z para cima), girado para a tela */
  private mundo = new THREE.Group();
  private peca: THREE.Mesh;
  private mesa = new THREE.Group();
  private raio = 120;
  private quadro = 0;

  constructor(private alvo: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setClearColor(0xf4f6f8);
    alvo.append(this.renderer.domElement);
    const sol = new THREE.DirectionalLight(0xffffff, 1.6);
    sol.position.set(0.5, 1, 0.7);
    const contra = new THREE.DirectionalLight(0xffffff, 0.5);
    contra.position.set(-0.6, 0.3, -0.8);
    this.cena.add(sol, contra, new THREE.AmbientLight(0xffffff, 0.55));
    this.mundo.rotation.x = -Math.PI / 2;
    this.peca = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial({ color: 0x2f7fd0, roughness: 0.55, metalness: 0.05 }));
    this.mundo.add(this.mesa, this.peca);
    this.cena.add(this.mundo);
    this.camera.position.set(220, 180, 260);
    this.controles = new OrbitControls(this.camera, this.renderer.domElement);
    this.controles.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.ROTATE, RIGHT: THREE.MOUSE.PAN };
    this.controles.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
    this.controles.zoomToCursor = true;
    this.controles.addEventListener("change", () => this.desenhar());
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

  /** Peça em coordenadas de impressão. `cabe` pinta de vermelho a peça que sai da mesa. */
  definirPeca(pos: Float32Array, tri: Uint32Array, cabe: boolean) {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setIndex(new THREE.BufferAttribute(tri, 1));
    g.computeVertexNormals();
    this.peca.geometry.dispose();
    this.peca.geometry = g;
    (this.peca.material as THREE.MeshStandardMaterial).color.set(cabe ? 0x2f7fd0 : 0xc9372c);
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
