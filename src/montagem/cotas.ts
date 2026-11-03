// Cotas dos componentes na montagem (como o duplo clique numa face na Peça): as cotas dos esboços
// do recurso e os valores dele (D1, R, espessura…) aparecem sobre o componente, na posição dele na
// montagem, e podem ser editadas no lugar. A edição muda a peça embutida (todas as instâncias);
// quem chama reconstrói a peça, refaz os posicionamentos e marca a peça como modificada.

import type * as THREE from "three";
import { ehCota, esbocosAbsorvidos, type Documento, type Feature, type FeatureEsboco, type Vec3 } from "../model";
import { desenharCota, textoCota } from "../esboco/cotas";
import { paraMundo, referencial, type Referencial } from "../esboco/referencial";
import { construirCamada, descartarCamada } from "../esboco/visual";
import { CotasNoModelo, type RotuloModelo } from "../ui/cotasModelo";
import { ler } from "../ui/formulario";
import { aplicarEquacoes, avaliarExpressao, resolverVariaveis } from "../equacoes";
import type { Viewport } from "../viewport";
import { aplicarDirecao, aplicarPonto, marcaDaPeca, type PecaEmbutida, type Transformacao } from "./modelo";
import type { ResultadoComponente } from "../kernel/cliente";
import { atualizarExternas } from "../esboco/externas";
import { capturarAtiva, PARAMETROS_RECURSO } from "../configuracoes";
import type { SolverEsboco } from "../esboco/solver";

/** Referencial da peça levado para a montagem (posição do componente). */
export function referencialNaMontagem(r: Referencial, t: Transformacao): Referencial {
  return { origem: aplicarPonto(t, r.origem), x: aplicarDirecao(t, r.x), y: aplicarDirecao(t, r.y), normal: aplicarDirecao(t, r.normal) };
}

/** O recurso mais recente da peça que tem a face (índice local) entre as "suas" faces. */
export function recursoDaFace(doc: Documento, facesPorRecurso: Record<string, number[]> | undefined, indice: number): Feature | null {
  let achado: Feature | null = null;
  for (const f of doc.features.slice(0, doc.retrocesso ?? doc.features.length)) if (facesPorRecurso?.[f.id]?.includes(indice)) achado = f;
  return achado;
}

function gravarCaminho(obj: Record<string, unknown>, cam: string, v: unknown) {
  const partes = cam.split(".");
  const ult = partes.pop()!;
  let o = obj;
  for (const k of partes) o = (o[k] ??= {}) as Record<string, unknown>;
  o[ult] = v;
}

export interface AlvoCotas {
  doc: Documento;
  t: Transformacao;
  /** planos de referência da peça (esboços neles) */
  planos: Map<string, Referencial>;
  /** centro (na montagem) das faces do recurso, para os valores dele */
  centroDoRecurso(f: Feature): Vec3 | null;
}

export class CotasDaMontagem {
  private cotas: CotasNoModelo;
  private camadas: THREE.Group[] = [];
  /** recurso mostrado (para mostrar de novo depois da reconstrução) */
  atual: { comp: string; recurso: string } | null = null;

  constructor(
    private vp: Viewport,
    camada: HTMLElement,
    private obterSolver: () => Promise<SolverEsboco>,
    /** a peça mudou: reconstruir, refazer posicionamentos, marcar modificada */
    private aoAlterar: () => void,
  ) {
    this.cotas = new CotasNoModelo(vp, camada);
  }

  get editando() {
    return this.cotas.editando;
  }

  fechar() {
    this.atual = null;
    this.cotas.limpar();
    for (const c of this.camadas) {
      this.vp.grupoEsboco.remove(c);
      descartarCamada(c);
    }
    this.camadas = [];
    this.vp.pedirRender();
  }

  /** Mostra as cotas do recurso; devolve quantas (0 = nada a mostrar). */
  mostrar(comp: string, f: Feature, alvo: AlvoCotas): number {
    this.fechar();
    const rotulos = this.rotulos(f, alvo);
    if (!rotulos.length) return 0;
    this.atual = { comp, recurso: f.id };
    this.cotas.mostrar(rotulos);
    this.vp.pedirRender();
    return rotulos.length;
  }

  private rotulos(f: Feature, alvo: AlvoCotas): RotuloModelo[] {
    const doc = alvo.doc;
    const valores = () => resolverVariaveis(doc.variaveis).valores;
    const fmt = (v: number) => Number(v.toFixed(3)).toLocaleString("pt-BR", { maximumFractionDigits: 3 });
    const rotulos: RotuloModelo[] = [];
    const { w, h } = this.vp.tamanho();

    // cotas dos esboços usados pelo recurso (ou do próprio esboço)
    for (const id of f.tipo === "esboco" ? [f.id] : esbocosAbsorvidos(f)) {
      const esb = doc.features.find((x): x is FeatureEsboco => x.id === id && x.tipo === "esboco");
      if (!esb) continue;
      let ref: Referencial;
      try {
        ref = referencialNaMontagem(referencial(esb.suporte, alvo.planos), alvo.t);
      } catch {
        continue; // plano de referência que não existe mais: sem cotas deste esboço
      }
      const mmPx = this.vp.mmPorPixel(ref);
      const camada = construirCamada(esb, { ref, mmPx, resolucao: { w, h }, editando: false, mostrarCotas: true });
      this.vp.grupoEsboco.add(camada);
      this.camadas.push(camada);
      for (const c of esb.restricoes) {
        if (!ehCota(c)) continue;
        const d = desenharCota(c, esb, mmPx);
        if (!d) continue;
        rotulos.push({
          texto: textoCota(c),
          edicao: c.expr ?? String(Number(c.valor.toFixed(4))),
          pos: paraMundo(ref, d.texto.x, d.texto.y),
          fixo: !!c.referencia,
          aplicar: (t) => {
            const v = avaliarExpressao(t, valores());
            if (!Number.isFinite(v) || v <= 0) return false;
            c.valor = v;
            if (t.trim().startsWith("=")) c.expr = t.trim();
            else delete c.expr;
            void this.obterSolver().then((s) => {
              s.resolver(esb);
              this.aoAlterar();
            });
            return true;
          },
        });
      }
    }
    // valores do próprio recurso, no centro das faces dele
    const centro = alvo.centroDoRecurso(f);
    const params = (PARAMETROS_RECURSO[f.tipo] ?? []).filter(([, , , vis]) => !vis || vis(f as never));
    params.forEach(([cam, rot, un], i) => {
      const v = ler(f as unknown as Record<string, unknown>, cam) as number | undefined;
      if (typeof v !== "number" || !centro) return;
      const chave = `${f.id}.${cam}`;
      rotulos.push({
        texto: `${rot} ${fmt(v)}${un ? (un === "°" ? "°" : ` ${un}`) : ""}`,
        edicao: doc.equacoes?.[chave] ?? String(v),
        pos: centro,
        desloc: (i - (params.length - 1) / 2) * 30,
        aplicar: (t) => {
          const n = avaliarExpressao(t, valores());
          if (!Number.isFinite(n) || n <= 0) return false;
          gravarCaminho(f as unknown as Record<string, unknown>, cam, cam.endsWith("instancias") ? Math.max(1, Math.round(n)) : n);
          doc.equacoes ??= {};
          if (t.trim().startsWith("=")) doc.equacoes[chave] = t.trim();
          else delete doc.equacoes[chave];
          this.aoAlterar();
          return true;
        },
      });
    });
    return rotulos;
  }
}

/**
 * Depois de editar a peça embutida: equações da peça, esboços que elas mudaram, valores da
 * configuração ativa, marca do conteúdo (a montagem reconstrói) e "modificada" (falta salvar).
 */
export async function prepararPecaAlterada(p: PecaEmbutida, obterSolver: () => Promise<SolverEsboco>) {
  const { esbocosAlterados } = aplicarEquacoes(p.doc);
  if (esbocosAlterados.length) {
    const s = await obterSolver();
    for (const id of esbocosAlterados) {
      const e = p.doc.features.find((f) => f.id === id);
      if (e?.tipo === "esboco") s.resolver(e);
    }
  }
  capturarAtiva(p.doc);
  p.marca = marcaDaPeca(p.doc);
  p.modificada = true;
}

/**
 * Como na Peça depois de reconstruir: esboços em face guardam o plano novo (a face andou) e as
 * referências do modelo nos esboços passam para a peça nova (resolvendo o esboço de novo).
 * Devolve true se algo mudou (a peça precisa ser reconstruída mais uma vez).
 */
export async function acompanharPecaEmbutida(p: PecaEmbutida, r: ResultadoComponente, planos: Map<string, Referencial>, obterSolver: () => Promise<SolverEsboco>): Promise<boolean> {
  let mudou = false;
  for (const [id, s] of Object.entries(r.suportes ?? {})) {
    const e = p.doc.features.find((f) => f.id === id);
    if (e?.tipo === "esboco" && JSON.stringify(e.suporte) !== JSON.stringify(s)) {
      e.suporte = s;
      mudou = true;
    }
  }
  if (r.topologia) {
    const fim = p.doc.retrocesso ?? p.doc.features.length;
    const comExternas = p.doc.features.slice(0, fim).filter((f): f is FeatureEsboco => f.tipo === "esboco" && !f.suprimida && f.geos.some((g) => g.externa));
    for (const e of comExternas) {
      let ref: Referencial;
      try {
        ref = referencial(e.suporte, planos);
      } catch {
        continue;
      }
      if (atualizarExternas(e, r.topologia, ref).mudaram) {
        (await obterSolver()).resolver(e);
        mudou = true;
      }
    }
  }
  if (mudou) p.marca = marcaDaPeca(p.doc);
  return mudou;
}
