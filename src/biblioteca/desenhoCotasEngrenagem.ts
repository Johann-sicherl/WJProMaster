// Desenho das cotas de diâmetro da engrenagem sobre o modelo (Peça e Montagem): linha de cota com setas nas
// pontas (tracejada no primitivo) e o valor "Øxx" preso ao ponto 3D, no estilo das cotas do esboço. As contas
// (posição e valor) ficam em `cotasEngrenagem.ts`; aqui só three e DOM. Mostrar/esconder não regenera sólido.

import * as THREE from "three";
import type { ParamEngrenagem, Vec3 } from "../model";
import type { Viewport } from "../viewport";
import { CotasNoModelo } from "../ui/cotasModelo";
import { cotasDiametro, type TipoCotaEng } from "./cotasEngrenagem";

const COR_COTA = 0x2c5d8f; // a mesma das cotas do esboço (src/esboco/visual.ts)

export interface EngrenagemNaVista {
  p: Partial<ParamEngrenagem>;
  /** referencial da peça → mundo (componente da Montagem); sem isto, a peça já está no mundo */
  mapa?: (v: Vec3) => Vec3;
}

export class CotasEngrenagemNaVista {
  private readonly rotulos: CotasNoModelo;
  private grupo: THREE.Group | null = null;

  constructor(private vp: Viewport, pai: HTMLElement) {
    const camada = Object.assign(document.createElement("div"), { className: "camada-cotas-modelo camada-cotas-eng" });
    pai.appendChild(camada);
    this.rotulos = new CotasNoModelo(vp, camada);
  }

  /** Quantas linhas de cota estão na vista (para teste e para saber se há o que limpar). */
  get quantas(): number {
    return this.grupo?.children.length ? this.grupo.userData.quantas : 0;
  }

  mostrar(itens: EngrenagemNaVista[], quais: Iterable<TipoCotaEng>) {
    this.limpar();
    const lista = [...quais];
    if (!lista.length || !itens.length) return;
    const grupo = new THREE.Group();
    grupo.userData.quantas = 0;
    const rotulos = [];
    for (const it of itens) {
      const mapa = it.mapa ?? ((v: Vec3) => v);
      for (const c of cotasDiametro(it.p, lista)) {
        const v = (x: Vec3) => new THREE.Vector3(...mapa(x));
        const a = v(c.a), b = v(c.b);
        const seta = Math.min(0.1 * c.raio, 6);
        const dir = b.clone().sub(a).normalize();
        // perpendicular no plano da circunferência (eixo Y da peça, levado ao mundo)
        const eixo = v([0, 1, 0]).sub(v([0, 0, 0])).normalize();
        const perp = new THREE.Vector3().crossVectors(dir, eixo).normalize();
        const pts: THREE.Vector3[] = [a, b];
        for (const [ponta, sentido] of [[a, 1], [b, -1]] as const) {
          for (const lado of [1, -1]) pts.push(ponta.clone(), ponta.clone().addScaledVector(dir, sentido * seta).addScaledVector(perp, lado * seta * 0.35));
        }
        const geo = new THREE.BufferGeometry().setFromPoints(pts);
        const mat = c.tracejada
          ? new THREE.LineDashedMaterial({ color: COR_COTA, depthTest: false, transparent: true, dashSize: Math.max(c.raio * 0.06, 0.5), gapSize: Math.max(c.raio * 0.03, 0.25) })
          : new THREE.LineBasicMaterial({ color: COR_COTA, depthTest: false, transparent: true });
        const linhas = new THREE.LineSegments(geo, mat);
        if (c.tracejada) linhas.computeLineDistances();
        linhas.renderOrder = 11;
        linhas.userData.tipo = c.tipo;
        grupo.add(linhas);
        grupo.userData.quantas++;
        rotulos.push({ texto: c.texto, edicao: String(Number(c.valor.toFixed(4))), pos: mapa(c.pos), fixo: true, aplicar: () => false });
      }
    }
    this.grupo = grupo;
    this.vp.grupoEsboco.add(grupo);
    this.rotulos.mostrar(rotulos);
    this.vp.pedirRender();
  }

  limpar() {
    this.rotulos.limpar();
    if (!this.grupo) return;
    this.vp.grupoEsboco.remove(this.grupo);
    this.grupo.traverse((o) => {
      if (o instanceof THREE.LineSegments) {
        o.geometry.dispose();
        (o.material as THREE.Material).dispose();
      }
    });
    this.grupo = null;
    this.vp.pedirRender();
  }
}
