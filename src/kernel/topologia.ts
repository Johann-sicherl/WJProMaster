// Topologia da peça para seleção e referências persistentes.
// Cada face/aresta ganha uma "assinatura" geométrica (tipo, centro, normal/eixo, área/comprimento) e,
// quando a história permite, um NOME PERSISTENTE (src/kernel/nomes.ts). Na reconstrução a referência é
// achada pelo nome; a assinatura fica de reserva (STEP importado, faces de filete…) e para desempatar.

import { cast, downcast, getOC, HASH_CODE_MAX, measureArea, type Edge, type Face, type Shape3D } from "replicad";
import type { AssinaturaAresta, AssinaturaFace, Referencia, Vec3 } from "../model";
import { registroAtual, type RegistroNomes } from "./nomes";

const tupla = (v: { x: number; y: number; z: number }): Vec3 => [v.x, v.y, v.z];
const dist3 = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const esc3 = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const gp = (p: { X(): number; Y(): number; Z(): number }): Vec3 => [p.X(), p.Y(), p.Z()];

type Adaptador = {
  GetType(): { value: number } | number;
  Circle(): { Radius(): number; Location(): never; Axis(): { Direction(): never } };
  Cylinder(): { Radius(): number; Axis(): { Location(): never; Direction(): never } };
  Cone(): { Axis(): { Location(): never; Direction(): never }; RefRadius(): number };
};

export function assinaturaFace(f: Face): AssinaturaFace {
  const tipo = f.geomType;
  const ass: AssinaturaFace = {
    geom: tipo === "PLANE" ? "plano" : tipo === "CYLINDRE" ? "cilindro" : tipo === "CONE" ? "cone" : tipo === "SPHERE" ? "esfera" : "outra",
    centro: tupla(f.center),
    area: measureArea(f),
  };
  try {
    if (ass.geom === "plano") ass.normal = tupla(f.normalAt());
    else if (ass.geom === "cilindro" || ass.geom === "cone") {
      const ad = (f as unknown as { _geomAdaptor(): Adaptador })._geomAdaptor();
      const eixo = ass.geom === "cilindro" ? ad.Cylinder().Axis() : ad.Cone().Axis();
      ass.eixo = gp(eixo.Direction());
      ass.pontoEixo = gp(eixo.Location());
      if (ass.geom === "cilindro") ass.raio = ad.Cylinder().Radius();
    }
  } catch {
    /* sem dados extras: a assinatura básica basta */
  }
  return ass;
}

export function assinaturaAresta(e: Edge): AssinaturaAresta {
  const tipo = e.geomType;
  const ass: AssinaturaAresta = {
    geom: tipo === "LINE" ? "linha" : tipo === "CIRCLE" ? "circulo" : "outra",
    meio: tupla(e.pointAt(0.5)),
    a: tupla(e.startPoint),
    b: tupla(e.endPoint),
    comprimento: e.length,
  };
  if (ass.geom === "circulo") {
    try {
      const c = (e as unknown as { _geomAdaptor(): Adaptador })._geomAdaptor().Circle();
      ass.raio = c.Radius();
      ass.centro = gp(c.Location());
      ass.eixo = gp(c.Axis().Direction());
    } catch {
      /* ignora */
    }
  }
  return ass;
}

export interface Topologia {
  faces: AssinaturaFace[];
  arestas: AssinaturaAresta[];
  vertices: Vec3[];
  /** Índices (em `arestas`) das arestas de cada face (contorno externo e furos). */
  arestasDaFace?: number[][];
}

const cache = new WeakMap<Shape3D, { faces: Face[]; arestas: Edge[]; topo: Topologia }>();

/**
 * Faces (ou arestas) da forma, sem repetição, na mesma ordem de `forma.faces`/`forma.edges` do
 * replicad (primeira ocorrência no explorador), em tempo linear: o replicad compara cada item com
 * todos os já vistos (quadrático: 7 s para 4 mil arestas num sólido vindo de STL). Aqui só se
 * compara dentro do mesmo código de hash.
 */
export function listarTopo(forma: { wrapped: unknown }, tipo: "face"): Face[];
export function listarTopo(forma: { wrapped: unknown }, tipo: "aresta"): Edge[];
export function listarTopo(forma: { wrapped: unknown }, tipo: "face" | "aresta"): (Face | Edge)[] {
  const oc = getOC() as never as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  const exp = new oc.TopExp_Explorer(forma.wrapped, oc.TopAbs_ShapeEnum[tipo === "face" ? "TopAbs_FACE" : "TopAbs_EDGE"], oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
  const vistos = new Map<number, { IsSame(x: unknown): boolean }[]>();
  const out: (Face | Edge)[] = [];
  try {
    for (; exp.More(); exp.Next()) {
      const item = exp.Current();
      const h = oc.ReplicadShapeHasher.HashCode(item, HASH_CODE_MAX) as number;
      const l = vistos.get(h);
      if (l?.some((x) => x.IsSame(item))) continue;
      if (l) l.push(item);
      else vistos.set(h, [item]);
      out.push(cast(downcast(item)) as unknown as Face | Edge);
    }
  } finally {
    exp.delete();
  }
  return out;
}

/** Sólidos de uma forma (corpos da peça), sem repetição. */
export function listarSolidos(forma: { wrapped: unknown }): Shape3D[] {
  const oc = getOC() as never as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  const exp = new oc.TopExp_Explorer(forma.wrapped, oc.TopAbs_ShapeEnum.TopAbs_SOLID, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
  const out: Shape3D[] = [];
  try {
    for (; exp.More(); exp.Next()) out.push(cast(downcast(exp.Current())) as unknown as Shape3D);
  } finally {
    exp.delete();
  }
  return out;
}

/** Índices (na lista `todas`) das faces de `parte` — por hash + IsSame, linear. */
export function indicesDasFaces(todas: Face[], parte: Face[]): number[] {
  const oc = getOC() as never as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  const mapa = new Map<number, number[]>();
  todas.forEach((f, i) => {
    const h = oc.ReplicadShapeHasher.HashCode((f as unknown as { wrapped: unknown }).wrapped, HASH_CODE_MAX) as number;
    const l = mapa.get(h);
    if (l) l.push(i);
    else mapa.set(h, [i]);
  });
  const out: number[] = [];
  for (const f of parte) {
    const w = (f as unknown as { wrapped: { IsSame(x: unknown): boolean } }).wrapped;
    const h = oc.ReplicadShapeHasher.HashCode(w, HASH_CODE_MAX) as number;
    const i = (mapa.get(h) ?? []).find((k) => w.IsSame((todas[k] as unknown as { wrapped: unknown }).wrapped));
    if (i !== undefined) out.push(i);
  }
  return out;
}

export function topologia(peca: Shape3D) {
  let t = cache.get(peca);
  if (t) return t;
  const faces = listarTopo(peca, "face");
  const arestas = listarTopo(peca, "aresta");
  // vértices sem repetição (grade de 1e-6: só compara com os da mesma célula e das vizinhas)
  const vs: Vec3[] = [];
  const grade = new Map<string, number[]>();
  const cel = (x: number) => Math.round(x / 1e-6);
  const add = (p: Vec3) => {
    const c = p.map(cel);
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (let dz = -1; dz <= 1; dz++)
          for (const k of grade.get(`${c[0] + dx},${c[1] + dy},${c[2] + dz}`) ?? []) if (dist3(p, vs[k]) < 1e-6) return;
    const chave = `${c[0]},${c[1]},${c[2]}`;
    const l = grade.get(chave);
    if (l) l.push(vs.length);
    else grade.set(chave, [vs.length]);
    vs.push(p);
  };
  const assA = arestas.map(assinaturaAresta);
  for (const a of assA) {
    add(a.a);
    add(a.b);
  }
  // arestas de cada face (para converter a face inteira no esboço): busca pelo hash do OCC
  const porHash = new Map<number, number[]>();
  arestas.forEach((e, i) => {
    const h = e.hashCode;
    porHash.set(h, [...(porHash.get(h) ?? []), i]);
  });
  const arestasDaFace = faces.map((f) => {
    const r: number[] = [];
    for (const e of f.edges) {
      const i = (porHash.get(e.hashCode) ?? []).find((k) => arestas[k].isSame(e));
      if (i !== undefined && !r.includes(i)) r.push(i);
    }
    return r;
  });
  t = { faces, arestas, topo: { faces: faces.map(assinaturaFace), arestas: assA, vertices: vs, arestasDaFace } };
  cache.set(peca, t);
  return t;
}

export class ErroReferencia extends Error {}

/** Diferença relevante entre duas assinaturas (só a geometria; o nome é tratado à parte). */
function mudou(a: object, b: object): boolean {
  const A = a as Record<string, unknown>, B = b as Record<string, unknown>;
  for (const k of Object.keys(B)) {
    if (k === "nome") continue;
    const x = A[k], y = B[k];
    if (typeof y === "number") {
      if (typeof x !== "number" || Math.abs(x - y) > 1e-7) return true;
    } else if (Array.isArray(y)) {
      if (!Array.isArray(x) || y.some((v, i) => Math.abs((x[i] as number) - (v as number)) > 1e-7)) return true;
    } else if (x !== y) return true;
  }
  return false;
}

/**
 * Atualiza a referência guardada com a entidade achada nesta reconstrução: nome persistente (a
 * referência antiga, só com assinatura, ganha o nome na primeira reconstrução) e a geometria nova (a
 * reserva acompanha a peça). Anota o valor de antes para a interface gravar no documento.
 */
function atualizarRef<T extends object>(reg: RegistroNomes, guardada: T, achada: T, nome: unknown) {
  const temNome = (guardada as { nome?: unknown }).nome !== undefined;
  const novoNome = !temNome && nome !== undefined;
  if (!novoNome && !mudou(guardada, achada)) return;
  reg.anotar(guardada);
  const { nome: _n, ...geo } = achada as { nome?: unknown };
  Object.assign(guardada, geo);
  if (novoNome) (guardada as { nome?: unknown }).nome = nome;
}

/** Registro de nomes que vale para esta peça (feita na reconstrução em andamento). */
function registroDa(peca: Shape3D): RegistroNomes | null {
  const reg = registroAtual();
  return reg?.conhece(peca) ? reg : null;
}

const notaFace = (f: AssinaturaFace, ass: AssinaturaFace) =>
  dist3(f.centro, ass.centro) + Math.abs(f.area - ass.area) / Math.max(1, Math.sqrt(ass.area)) +
  (ass.raio !== undefined && f.raio !== undefined ? Math.abs(ass.raio - f.raio) * 2 : 0);

/** Índice da face pela assinatura (reserva), ou -1. */
function faceDaAssinatura(faces: AssinaturaFace[], ass: AssinaturaFace): number {
  let melhor = -1, nota = Infinity;
  faces.forEach((f, i) => {
    if (f.geom !== ass.geom) return;
    if (ass.normal && f.normal && esc3(ass.normal, f.normal) < 0.995) return;
    if (ass.eixo && f.eixo && Math.abs(esc3(ass.eixo, f.eixo)) < 0.995) return;
    const n = notaFace(f, ass);
    if (n < nota) { nota = n; melhor = i; }
  });
  return melhor >= 0 && nota <= Math.max(2, 0.25 * Math.sqrt(ass.area)) ? melhor : -1;
}

/** Índice (em `topologia(peca).faces`) da face guardada: pelo nome; sem nome (ou nome perdido), pela assinatura. */
export function indiceDaFace(peca: Shape3D, ass: AssinaturaFace): number {
  const { topo } = topologia(peca);
  const reg = registroDa(peca);
  let i = -1;
  if (reg && ass.nome && reg.temNome(ass.nome)) {
    let nota = Infinity;
    for (const k of reg.facesDoNome(ass.nome, topo.faces)) {
      const n = notaFace(topo.faces[k], ass);
      if (n < nota) { nota = n; i = k; }
    }
  }
  if (i < 0) i = faceDaAssinatura(topo.faces, ass);
  if (i >= 0 && reg) atualizarRef(reg, ass, topo.faces[i], reg.nomeDaFace(topo.faces[i]));
  return i;
}

/** Face da peça atual que corresponde à referência guardada (nome persistente; reserva: assinatura). */
export function acharFace(peca: Shape3D, ass: AssinaturaFace): Face {
  const i = indiceDaFace(peca, ass);
  if (i < 0) {
    const reg = registroAtual();
    throw new ErroReferencia(`${maiuscula(reg ? reg.descrever(ass, "face") : "uma face selecionada")} não existe mais: reselecione.`);
  }
  return topologia(peca).faces[i];
}

const maiuscula = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

const notaAresta = (a: AssinaturaAresta, ass: AssinaturaAresta) => dist3(a.meio, ass.meio) + Math.abs(a.comprimento - ass.comprimento) * 0.5;

/** Arestas que ficam entre as faces de `n1` e as de `n2`. */
function arestasEntre(reg: RegistroNomes, topo: Topologia, n1: string, n2: string): number[] {
  if (!topo.arestasDaFace) return [];
  const de = (n: string) => {
    const s = new Set<number>();
    for (const f of reg.facesDoNome(n, topo.faces)) for (const a of topo.arestasDaFace![f]) s.add(a);
    return s;
  };
  const a = de(n1), b = de(n2);
  return [...a].filter((x) => b.has(x));
}

export function indiceDaAresta(peca: Shape3D, ass: AssinaturaAresta): number {
  const { topo } = topologia(peca);
  const reg = registroDa(peca);
  let i = -1;
  if (reg && ass.nome && reg.temNome(ass.nome[0]) && reg.temNome(ass.nome[1])) {
    let nota = Infinity;
    for (const k of arestasEntre(reg, topo, ass.nome[0], ass.nome[1])) {
      const a = topo.arestas[k];
      if (a.geom !== ass.geom) continue;
      const n = notaAresta(a, ass);
      if (n < nota) { nota = n; i = k; }
    }
  }
  if (i < 0) {
    let nota = Infinity;
    topo.arestas.forEach((a, k) => {
      if (a.geom !== ass.geom) return;
      const n = notaAresta(a, ass);
      if (n < nota) { nota = n; i = k; }
    });
    if (i >= 0 && nota > Math.max(1, 0.3 * ass.comprimento)) i = -1;
  }
  if (i >= 0 && reg) atualizarRef(reg, ass, topo.arestas[i], reg.nomeDasArestas(topo)[i]);
  return i;
}

export function acharAresta(peca: Shape3D, ass: AssinaturaAresta): Edge {
  const i = indiceDaAresta(peca, ass);
  if (i < 0) {
    const reg = registroAtual();
    throw new ErroReferencia(`${maiuscula(reg ? reg.descrever(ass, "aresta") : "uma aresta selecionada")} não existe mais: reselecione.`);
  }
  return topologia(peca).arestas[i];
}

/**
 * Arestas pedidas por uma lista de itens (arestas e todas as arestas das faces). Com `perdidos`, item
 * que não foi achado não derruba o recurso: vai para a lista (índice e mensagem) e os outros seguem.
 */
export function arestasDosItens(peca: Shape3D, itens: Referencia[], perdidos?: { i: number; mensagem: string }[]): Edge[] {
  const out: Edge[] = [];
  const add = (e: Edge) => {
    if (!out.some((x) => x.isSame(e))) out.push(e);
  };
  itens.forEach((it, i) => {
    try {
      if (it.tipo === "aresta") add(acharAresta(peca, it.ass));
      else if (it.tipo === "face") {
        const f = acharFace(peca, it.ass);
        for (const e of peca.edges) if (f.edges.some((x) => x.isSame(e))) add(e);
      }
    } catch (e) {
      if (!perdidos || !(e instanceof ErroReferencia)) throw e;
      perdidos.push({ i, mensagem: e.message });
    }
  });
  return out;
}

/** Acrescenta as arestas ligadas por tangência contínua (propagação tangente). */
export function propagarTangente(peca: Shape3D, base: Edge[]): Edge[] {
  const todas = peca.edges;
  const out = [...base];
  const tangEm = (e: Edge, p: Vec3): Vec3 | null => {
    const a = tupla(e.startPoint), b = tupla(e.endPoint);
    if (dist3(a, p) < 1e-5) return tupla(e.tangentAt(0));
    if (dist3(b, p) < 1e-5) return tupla(e.tangentAt(1));
    return null;
  };
  let mudou = true;
  while (mudou) {
    mudou = false;
    for (const e of out.slice()) {
      for (const p of [tupla(e.startPoint), tupla(e.endPoint)]) {
        const t1 = tangEm(e, p);
        if (!t1) continue;
        for (const o of todas) {
          if (out.some((x) => x.isSame(o))) continue;
          const t2 = tangEm(o, p);
          if (!t2) continue;
          const c = Math.abs(esc3(t1, t2)) / (Math.hypot(...t1) * Math.hypot(...t2) || 1);
          if (c > 0.9995) {
            out.push(o);
            mudou = true;
          }
        }
      }
    }
  }
  return out;
}

export { dist3, esc3 };
