// Onde mostrar as cotas de um recurso sobre o modelo (duplo clique/duplo toque no corpo ou no recurso,
// pedido do Johann, 15/11/2026). Módulo puro (testado em Node por `scripts/teste-cotas-recurso.ts`).
//
// O lugar natural é o centro das faces do recurso na peça final. Mas há recursos que perdem as faces
// para um recurso seguinte (Mover corpo e Escala refazem todas as faces; Casca e cortes podem recortar
// as laterais) e recursos que nunca têm faces (plano de referência). Antes o rótulo era pulado em
// silêncio; agora há reservas, na ordem: esboço do recurso (a extrusão vai na ponta, como a seta do
// comando), plano/eixo/ponto de referência, faces/arestas que o recurso usa e, por último, o meio da peça.

import type { Feature, FeatureEsboco, Referencia, Vec3 } from "./model";
import type { InfoReferencia } from "./kernel/regenerar";
import { paraMundo, referencial } from "./esboco/referencial";

export type OrigemLugar = "faces" | "esboço" | "referência" | "itens" | "peça";

export interface LugarCotas {
  pos: Vec3;
  origem: OrigemLugar;
}

const media = (ps: Vec3[]): Vec3 | null => {
  if (!ps.length) return null;
  const s = ps.reduce<Vec3>((a, p) => [a[0] + p[0], a[1] + p[1], a[2] + p[2]], [0, 0, 0]);
  return [s[0] / ps.length, s[1] / ps.length, s[2] / ps.length];
};

/** Centro (caixa) dos pontos do esboço no espaço, sem a origem nem as referências do modelo. */
function centroDoEsboco(esb: FeatureEsboco): { c: Vec3; normal: Vec3 } | null {
  let ref;
  try {
    ref = referencial(esb.suporte);
  } catch {
    return null;
  }
  const externos = new Set(esb.geos.filter((g) => g.externa).flatMap((g) => Object.values(g).filter((v): v is string => typeof v === "string")));
  const pts = esb.pontos.filter((p) => p.id !== "origem" && !externos.has(p.id));
  if (!pts.length) return null;
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  const u = (Math.min(...xs) + Math.max(...xs)) / 2, v = (Math.min(...ys) + Math.max(...ys)) / 2;
  return { c: paraMundo(ref, u, v), normal: ref.normal };
}

/** Pontos das faces/arestas/vértices que o recurso usa (filete, casca, inclinação, domo…). */
function pontosDosItens(f: Feature): Vec3[] {
  const o = f as unknown as Record<string, unknown>;
  const refs: Referencia[] = [];
  for (const k of ["itens", "faces", "arestas", "face", "faceFixa"]) {
    const v = o[k];
    if (Array.isArray(v)) refs.push(...(v as Referencia[]));
    else if (v && typeof v === "object" && "tipo" in v) refs.push(v as Referencia);
  }
  return refs.flatMap((r): Vec3[] => (r.tipo === "face" ? [r.ass.centro] : r.tipo === "aresta" ? [r.ass.meio] : r.tipo === "vertice" ? [r.p] : []));
}

/**
 * Lugar das cotas do recurso `f`. `centroFaces` é o da vista (centro da caixa das faces na malha
 * exibida; null se não há faces). null = o recurso não tem onde mostrar (a interface avisa).
 */
export function lugarDasCotas(
  f: Feature,
  features: Feature[],
  facesPorRecurso: Record<string, number[]>,
  referencias: InfoReferencia[],
  centroFaces: (faces: number[]) => Vec3 | null,
): LugarCotas | null {
  // 1) as faces do próprio recurso
  const proprias = facesPorRecurso[f.id] ?? [];
  const c = proprias.length ? centroFaces(proprias) : null;
  if (c) return { pos: c, origem: "faces" };

  // 2) o esboço do recurso (extrusão: na ponta, onde fica a seta D1 do comando)
  const idEsb = (f as { esboco?: unknown }).esboco;
  const esb = typeof idEsb === "string" ? features.find((x): x is FeatureEsboco => x.id === idEsb && x.tipo === "esboco") : undefined;
  const ce = esb && centroDoEsboco(esb);
  if (ce) {
    let s = 0;
    if (f.tipo === "extrusao") {
      const cond = f.condicao?.tipo ?? "cego";
      const de = f.de ?? { tipo: "plano", dist: 0, inverter: false };
      const s0 = de.tipo === "deslocamento" ? (de.inverter ? -1 : 1) * de.dist : 0;
      const sentido = f.inverter ? -1 : 1;
      s = s0 + sentido * (cond === "planoMedio" ? f.profundidade / 2 : cond === "cego" ? f.profundidade : 0);
    }
    const n = ce.normal;
    return { pos: [ce.c[0] + n[0] * s, ce.c[1] + n[1] * s, ce.c[2] + n[2] * s], origem: "esboço" };
  }

  // 3) referência criada pelo recurso (plano, eixo, ponto, sistema de coordenadas)
  const ref = referencias.find((r) => r.id === f.id);
  if (ref) {
    const p = ref.tipo === "plano" || ref.tipo === "sistema" ? ref.ref.origem : ref.tipo === "eixo" ? ref.origem : ref.tipo === "ponto" ? ref.p
      : media(ref.linhas.flat());
    if (p) return { pos: p, origem: "referência" };
  }

  // 4) faces/arestas/vértices que o recurso usa
  const pi = media(pontosDosItens(f));
  if (pi) return { pos: pi, origem: "itens" };

  // 5) o meio da peça (Mover corpo, Escala, padrões sem faces próprias…)
  const todas = [...new Set(Object.values(facesPorRecurso).flat())];
  const cp = todas.length ? centroFaces(todas) : null;
  return cp ? { pos: cp, origem: "peça" } : null;
}
