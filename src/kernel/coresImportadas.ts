// Cores do STEP importado ligadas às faces lidas pelo OpenCascade: cada sólido/face lido tem a caixa
// dos seus vértices comparada com as caixas dos itens pintados no arquivo (src/kernel/coresStep.ts).
// Saem as faces coloridas com a assinatura geométrica de cada uma (acompanham recursos depois).

import { getOC, type Face, type Shape3D } from "replicad";
import type { CorDeFace } from "../aparencia";
import { estilosDoStep, indiceDeCaixas, type Caixa, type EstilosStep } from "./coresStep";
import { assinaturaFace, listarSolidos, listarTopo } from "./topologia";

/** Caixa dos vértices da forma (null se não tem vértices, ex.: esfera inteira). */
function caixaDosVertices(forma: unknown): Caixa | null {
  const oc = getOC() as never as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  const exp = new oc.TopExp_Explorer(forma, oc.TopAbs_ShapeEnum.TopAbs_VERTEX, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
  const min: [number, number, number] = [Infinity, Infinity, Infinity], max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  let achou = false;
  try {
    for (; exp.More(); exp.Next()) {
      const p = oc.BRep_Tool.Pnt(oc.TopoDS.Vertex(exp.Current()));
      const v = [p.X(), p.Y(), p.Z()];
      p.delete();
      for (let k = 0; k < 3; k++) {
        if (v[k] < min[k]) min[k] = v[k];
        if (v[k] > max[k]) max[k] = v[k];
      }
      achou = true;
    }
  } finally {
    exp.delete();
  }
  return achou ? { min, max } : null;
}

/** Faces coloridas da forma lida, pelas cores do texto do STEP. */
export function coresDaForma(forma: Shape3D, est: EstilosStep): CorDeFace[] {
  if (!est.solidos.length && !est.faces.length) return [];
  const doSolido = indiceDeCaixas(est.solidos, 1);
  const daFace = indiceDeCaixas(est.faces, 0.5);
  const out: CorDeFace[] = [];
  for (const solido of listarSolidos(forma)) {
    const cs = est.solidos.length ? caixaDosVertices(solido.wrapped) : null;
    const corSolido = cs ? doSolido(cs)?.cor : undefined;
    for (const face of listarTopo(solido, "face") as Face[]) {
      const cf = est.faces.length ? caixaDosVertices(face.wrapped) : null;
      const cor = (cf ? daFace(cf)?.cor : undefined) ?? corSolido;
      if (cor !== undefined) out.push({ ass: assinaturaFace(face), cor });
    }
  }
  return out;
}

/** Cores de um STEP (bytes) aplicadas à forma lida dele. */
export function coresDoStep(bytes: Uint8Array, forma: Shape3D): CorDeFace[] {
  const texto = new TextDecoder("latin1").decode(bytes);
  return coresDaForma(forma, estilosDoStep(texto));
}
