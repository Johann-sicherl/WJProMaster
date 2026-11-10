// Quais faces da peça final pertencem a cada recurso (para destacar o recurso selecionado na
// árvore). A cada passo da regeneração, as faces novas que NÃO estão sobre a superfície da peça
// anterior são "do recurso" (paredes de um furo, laterais de um ressalto, o arredondamento de um
// filete…); faces só recortadas por ele continuam do recurso que as criou. No fim, cada face da
// peça final é atribuída aos recursos cujas faces próprias a contêm.

import { DistanceQuery, makeVertex, type Face, type Shape3D } from "replicad";
import type { Vec3 } from "../model";
import { listarTopo } from "./topologia";

const TOL = 1e-4;

type Caixa = { min: Vec3; max: Vec3 };

type FacePropria = { face: Face; caixa?: Caixa | null; consulta: DistanceQuery | null };

interface FacesProprias {
  id: string;
  /** caixa: undefined = ainda não calculada (só quando um teste geométrico precisa) */
  faces: FacePropria[];
  /** índice das faces planas pelo plano e as não planas (montado na primeira consulta) */
  indice?: { planas: IndicePlanos<FacePropria & { n: Vec3; d: number }>; curvas: FacePropria[] };
}

function indiceDe(r: FacesProprias): NonNullable<FacesProprias["indice"]> {
  if (r.indice) return r.indice;
  const planas: (FacePropria & { n: Vec3; d: number })[] = [];
  const curvas: FacePropria[] = [];
  for (const pr of r.faces) {
    const pl = planoDe(pr.face);
    if (pl) planas.push(Object.assign(pr, pl));
    else curvas.push(pr);
  }
  return (r.indice = { planas: new IndicePlanos(planas), curvas });
}

function caixaDe(f: Face): Caixa | null {
  try {
    const b = (f.boundingBox as unknown as { bounds: [Vec3, Vec3] }).bounds;
    return b && b[0].length === 3 ? { min: b[0], max: b[1] } : null;
  } catch {
    return null;
  }
}

const dentro = (p: Vec3, c: Caixa | null, folga: number) =>
  !c || [0, 1, 2].every((i) => p[i] >= c.min[i] - folga && p[i] <= c.max[i] + folga);

function distancia(consulta: DistanceQuery, p: Vec3): number {
  const v = makeVertex(p);
  try {
    return consulta.distanceTo(v);
  } finally {
    v.delete();
  }
}

/** Plano da face (normal unitária e distância à origem), se ela for plana. */
function planoDe(f: Face): { n: Vec3; d: number } | null {
  try {
    if (f.geomType !== "PLANE") return null;
    // plano: normal no meio do domínio UV e um ponto qualquer da superfície (o centro de massa da face
    // integra a superfície e projeta o ponto: ~0,5 ms por face, minutos num sólido vindo de STL)
    const c = f.pointOnSurface(0.5, 0.5), v = f.normalAt();
    const n: Vec3 = [v.x, v.y, v.z];
    const d = n[0] * c.x + n[1] * c.y + n[2] * c.z;
    c.delete();
    v.delete();
    return { n, d };
  } catch {
    return null;
  }
}

/** Balde do plano pela distância à origem (|d|, passo de 1 µm): n e −n caem no mesmo balde. */
const baldeDe = (d: number) => Math.round(Math.abs(d) * 1000);

/**
 * Faces planas agrupadas pelo plano (balde de |d|): uma face plana só pode estar sobre uma face do
 * mesmo plano, então cada consulta olha só o próprio balde e os vizinhos, não as milhares de faces de
 * um sólido vindo de STL (antes era quadrático: minutos no Mover corpo de uma peça de 15 mil faces).
 */
class IndicePlanos<T extends { n: Vec3; d: number }> {
  private baldes = new Map<number, T[]>();
  constructor(itens: T[]) {
    for (const x of itens) {
      const k = baldeDe(x.d);
      const l = this.baldes.get(k);
      if (l) l.push(x);
      else this.baldes.set(k, [x]);
    }
  }
  /** Itens do mesmo plano (normais paralelas, de qualquer sentido) que passam a até TOL do ponto. */
  doPlano(n: Vec3, p: Vec3): T[] {
    const k = baldeDe(n[0] * p[0] + n[1] * p[1] + n[2] * p[2]);
    const out: T[] = [];
    for (const kk of [k - 1, k, k + 1]) {
      for (const g of this.baldes.get(kk) ?? []) {
        const c = g.n[0] * n[0] + g.n[1] * n[1] + g.n[2] * n[2];
        if (c < 0.9999 && c > -0.9999) continue;
        if (Math.abs(g.n[0] * p[0] + g.n[1] * p[1] + g.n[2] * p[2] - g.d) > TOL) continue;
        out.push(g);
      }
    }
    return out;
  }
}

/** Ponto qualquer do plano (para achar o balde antes de ter um ponto da face). */
const pontoDoPlano = (pl: { n: Vec3; d: number }): Vec3 => [pl.n[0] * pl.d, pl.n[1] * pl.d, pl.n[2] * pl.d];

/** Um ponto que está de fato na face (o centro paramétrico pode cair num furo). */
function pontoNaFace(f: Face): Vec3 | null {
  const q = new DistanceQuery(f);
  try {
    for (const [u, v] of [[0.5, 0.5], [0.3, 0.3], [0.7, 0.7], [0.3, 0.7], [0.7, 0.3], [0.5, 0.15], [0.15, 0.5], [0.5, 0.85], [0.85, 0.5], [0.1, 0.1], [0.9, 0.9]]) {
      const p = f.pointOnSurface(u, v);
      const pt: Vec3 = [p.x, p.y, p.z];
      if (distancia(q, pt) < TOL) return pt;
    }
  } catch {
    /* sem ponto confiável */
  } finally {
    q.delete();
  }
  return null;
}

export class RastreadorFaces {
  private proprias: FacesProprias[] = [];

  /** Registra as faces próprias do recurso, comparando a peça antes e depois dele. */
  registrar(id: string, antes: Shape3D | null, depois: Shape3D | null) {
    if (!depois || depois === antes) return;
    try {
      const velhas = antes ? listarTopo(antes, "face") : [];
      const porHash = new Map<number, Face[]>();
      for (const f of velhas) {
        const h = f.hashCode;
        porHash.set(h, [...(porHash.get(h) ?? []), f]);
      }
      // a consulta à peça anterior inteira é cara em peças com milhares de faces (sólido vindo de
      // STL): só é criada se uma face nova NÃO plana precisar dela
      let consultaAntes: DistanceQuery | null = null;
      type PlanoAntigo = { n: Vec3; d: number; face: Face; caixa?: Caixa | null; q?: DistanceQuery };
      let planosAntes: PlanoAntigo[] | null = null;
      let indiceAntes: IndicePlanos<PlanoAntigo> | null = null;
      const planosDaPeca = () => {
        planosAntes ??= velhas.flatMap((g) => {
          const pl = planoDe(g);
          return pl ? [{ ...pl, face: g }] : [];
        });
        return (indiceAntes ??= new IndicePlanos(planosAntes));
      };
      const sobreAntiga = (f: Face, p: Vec3, plano: { n: Vec3; d: number } | null): boolean => {
        if (plano) {
          // face plana nova está sobre a peça anterior ⇔ está sobre uma face plana antiga do mesmo plano
          for (const g of planosDaPeca().doPlano(plano.n, p)) {
            if (g.caixa === undefined) g.caixa = caixaDe(g.face);
            if (!dentro(p, g.caixa, 1e-3)) continue;
            g.q ??= new DistanceQuery(g.face);
            if (distancia(g.q, p) < TOL) return true;
          }
          return false;
        }
        consultaAntes ??= new DistanceQuery(antes!);
        return distancia(consultaAntes, p) < TOL;
      };
      const faces: FacesProprias["faces"] = [];
      try {
        for (const f of listarTopo(depois, "face")) {
          if (porHash.get(f.hashCode)?.some((g) => g.isSame(f))) continue; // face intacta: não é deste recurso
          if (antes) {
            const plano = planoDe(f);
            // face plana sem nenhuma face antiga no mesmo plano: é nova (não precisa de ponto)
            if (!plano || planosDaPeca().doPlano(plano.n, pontoDoPlano(plano)).length) {
              const p = pontoNaFace(f);
              // face nova mas sobre a superfície antiga: só foi recortada
              if (p && sobreAntiga(f, p, plano)) continue;
            }
          }
          faces.push({ face: f, consulta: null });
        }
      } finally {
        (consultaAntes as DistanceQuery | null)?.delete();
        for (const g of (planosAntes as PlanoAntigo[] | null) ?? []) g.q?.delete();
      }
      if (faces.length) this.proprias.push({ id, faces });
    } catch {
      /* peça anterior já liberada pelo kernel: sem destaque para este recurso */
    }
  }

  /**
   * Índices (na ordem de `peca.faces`) das faces da peça final de cada recurso. Cada face vai para
   * o primeiro recurso (na ordem da árvore) que a tem: a mesma face (pelo hash, rápido) ou uma face
   * que a contém (teste geométrico, só nos recursos antes do que tem a face idêntica).
   */
  atribuir(peca: Shape3D): Record<string, number[]> {
    const out: Record<string, number[]> = {};
    try {
      // face idêntica, pelo hash: posição do recurso em `proprias`
      const porHash = new Map<number, { r: number; face: Face }[]>();
      this.proprias.forEach((r, k) => {
        for (const pr of r.faces) {
          const h = pr.face.hashCode;
          const l = porHash.get(h);
          if (l) l.push({ r: k, face: pr.face });
          else porHash.set(h, [{ r: k, face: pr.face }]);
        }
      });
      listarTopo(peca, "face").forEach((f, i) => {
        let igual = this.proprias.length;
        for (const c of porHash.get(f.hashCode) ?? []) {
          let mesma = false;
          try {
            mesma = c.face.isSame(f);
          } catch {
            mesma = false;
          }
          if (mesma && c.r < igual) igual = c.r;
        }
        // antes do recurso da face idêntica, algum recurso tem uma face que contém esta?
        let p: Vec3 | null | undefined;
        let dono = igual < this.proprias.length ? igual : -1;
        let plano: { n: Vec3; d: number } | null | undefined;
        for (let k = 0; k < igual; k++) {
          let achou = false;
          // face plana: só as faces do mesmo plano do recurso podem contê-la; curva: as curvas
          plano ??= planoDe(f);
          const ind = indiceDe(this.proprias[k]);
          const candidatas = plano ? ind.planas.doPlano(plano.n, pontoDoPlano(plano)) : ind.curvas;
          for (const pr of candidatas) {
            if (p === undefined) p = pontoNaFace(f);
            if (!p) break;
            if (pr.caixa === undefined) pr.caixa = caixaDe(pr.face);
            if (!dentro(p, pr.caixa, 1e-3)) continue;
            pr.consulta ??= new DistanceQuery(pr.face);
            if (distancia(pr.consulta, p) < TOL) {
              achou = true;
              break;
            }
          }
          if (achou) {
            dono = k;
            break;
          }
        }
        if (dono >= 0) (out[this.proprias[dono].id] ??= []).push(i);
      });
    } finally {
      for (const r of this.proprias) for (const pr of r.faces) pr.consulta?.delete();
    }
    return out;
  }
}
