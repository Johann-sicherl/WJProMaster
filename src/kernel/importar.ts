// Leitura de montagens STEP no kernel: cada sólido do arquivo vira uma instância posicionada;
// instâncias da mesma peça (mesma geometria compartilhada no STEP) viram uma peça só.
// Os nomes das peças vêm do texto do STEP (src/montagem/step.ts), porque o leitor do
// OpenCascade disponível no navegador não devolve os nomes dos produtos.

import { cast, getOC, measureShapeVolumeProperties, type Shape3D } from "replicad";
import type { Quat, Transformacao } from "../montagem/modelo";
import type { CorDeFace } from "../aparencia";
import { coresDaForma } from "./coresImportadas";
import { estilosDoStep } from "./coresStep";
import { listarTopo } from "./topologia";

export interface CorpoLido {
  /** STEP só desta peça, no sistema de coordenadas dela */
  step: Uint8Array;
  volume: number;
  /** quantas vezes aparece na montagem */
  n: number;
  /** cores do arquivo (STEP AP214): a peça toda numa cor só, ou cores por face */
  cor?: number;
  cores?: CorDeFace[];
}

export interface LeituraMontagem {
  corpos: CorpoLido[];
  /** na ordem em que aparecem no arquivo */
  instancias: { corpo: number; t: Transformacao }[];
}

/** Matriz de rotação (linhas) → quatérnio unitário. */
export function quatDeMatriz(m: number[][]): Quat {
  const [[a, b, c], [d, e, f], [g, h, i]] = m;
  const tr = a + e + i;
  let q: Quat;
  if (tr > 0) {
    const s = Math.sqrt(tr + 1) * 2;
    q = [(h - f) / s, (c - g) / s, (d - b) / s, s / 4];
  } else if (a > e && a > i) {
    const s = Math.sqrt(1 + a - e - i) * 2;
    q = [s / 4, (b + d) / s, (c + g) / s, (h - f) / s];
  } else if (e > i) {
    const s = Math.sqrt(1 + e - a - i) * 2;
    q = [(b + d) / s, s / 4, (f + h) / s, (c - g) / s];
  } else {
    const s = Math.sqrt(1 + i - a - e) * 2;
    q = [(c + g) / s, (f + h) / s, s / 4, (d - b) / s];
  }
  const n = Math.hypot(...q) || 1;
  return [q[0] / n, q[1] / n, q[2] / n, q[3] / n];
}

/**
 * Lê o STEP e separa os sólidos. Instância espelhada ou com escala (o componente não guarda
 * isso) vira peça própria, já na posição final.
 */
export async function lerMontagemStep(bytes: Uint8Array): Promise<LeituraMontagem> {
  const oc = getOC() as never as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  const nome = "/montagem-importada.step";
  oc.FS.writeFile(nome, bytes);
  const leitor = new oc.STEPControl_Reader();
  let raiz;
  try {
    if (leitor.ReadFile(nome) !== oc.IFSelect_ReturnStatus?.IFSelect_RetDone) throw new Error("Não foi possível ler o STEP (arquivo corrompido ou de outro tipo).");
    leitor.TransferRoots(new oc.Message_ProgressRange());
    raiz = leitor.OneShape();
  } finally {
    leitor.delete();
    try {
      oc.FS.unlink(nome);
    } catch {
      /* já apagado */
    }
  }
  const corpos: CorpoLido[] = [];
  const arquivos: Blob[] = [];
  const formas: unknown[] = []; // forma de cada corpo (reconhece outra instância da mesma peça)
  const instancias: LeituraMontagem["instancias"] = [];
  const identidade = new oc.TopLoc_Location();
  let estilos: ReturnType<typeof estilosDoStep> | null = null;
  try {
    estilos = estilosDoStep(new TextDecoder("latin1").decode(bytes));
  } catch {
    estilos = null; // cores são extra
  }
  const novoCorpo = (forma: unknown, chave: unknown) => {
    const s = cast(forma as never) as unknown as Shape3D;
    arquivos.push(s.blobSTEP());
    const corpo: CorpoLido = { step: new Uint8Array(0), volume: measureShapeVolumeProperties(s).volume, n: 0 };
    // cores no sistema da peça (os pontos do arquivo também estão nele)
    const cores = estilos ? coresDaForma(s, estilos) : [];
    if (cores.length) {
      const nFaces = listarTopo(s, "face").length;
      if (cores.length === nFaces && cores.every((c) => c.cor === cores[0].cor)) corpo.cor = cores[0].cor;
      else corpo.cores = cores;
    }
    corpos.push(corpo);
    formas.push(chave);
    return corpos.length - 1;
  };
  const exp = new oc.TopExp_Explorer(raiz, oc.TopAbs_ShapeEnum.TopAbs_SOLID, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
  for (; exp.More(); exp.Next()) {
    const solido = exp.Current();
    const trsf = solido.Location().Transformation();
    const rigida = !trsf.IsNegative() && Math.abs(trsf.ScaleFactor() - 1) < 1e-9;
    let i = rigida ? formas.findIndex((f) => f && solido.IsPartner(f)) : -1;
    let t: Transformacao = { pos: [0, 0, 0], rot: [0, 0, 0, 1] };
    if (rigida) {
      const m = [1, 2, 3].map((r) => [1, 2, 3].map((c) => trsf.Value(r, c) as number));
      t = { pos: [trsf.Value(1, 4), trsf.Value(2, 4), trsf.Value(3, 4)], rot: quatDeMatriz(m) };
      if (i < 0) i = novoCorpo(solido.Located(identidade, false), solido);
    } else i = novoCorpo(solido, null); // espelhada/escalada: peça própria, já no lugar
    corpos[i].n++;
    instancias.push({ corpo: i, t });
  }
  exp.delete();
  identidade.delete();
  if (!instancias.length) throw new Error("O STEP não tem sólidos para importar (só superfícies ou curvas).");
  for (let i = 0; i < corpos.length; i++) corpos[i].step = new Uint8Array(await arquivos[i].arrayBuffer());
  return { corpos, instancias };
}
