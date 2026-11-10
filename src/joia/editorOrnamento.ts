// WJGoldDiamond: editor de ornamentos = o esboço do WJCAD (mesmas ferramentas, relações, cotas e
// solver PlaneGCS) num viewport 2D. Carregado só quando o Johann abre um ornamento (import
// dinâmico): a página da joia continua leve.

import "../style.css"; // estilos do esboço do WJCAD (painel, cotas, relações, lupa)
import wasmPlaneGcs from "@salusoft89/planegcs/dist/planegcs_dist/planegcs.wasm?url";
import { escapar, menu } from "../comum/casca";
import { ABAS, type Comando as ComandoCad } from "../comandos";
import { ICONES } from "../icones";
import { Viewport } from "../viewport";
import { EditorEsboco, type Ferramenta } from "../esboco/editor";
import { renderizarPainelEsboco } from "../esboco/painel";
import { SolverEsboco } from "../esboco/solver";
import type { FeatureEsboco } from "../model";
import { amostrar, mapaPontos } from "../esboco/geometria";
import type { Simetria } from "./ornamento";
import { lerPrefsCad, relacoesAutoLigadas } from "../ui/preferenciasCad";

const FORA = new Set(["grupo-esboco", "grupo-converter", "escalaReal", "calibrarTela", "converter", "intersecao", "silhueta"]);
const SKETCH = ABAS.find((a) => a.id === "sketch")!.comandos.filter((c) => !FORA.has(c.id));

export interface OpcoesEditor {
  viewport: HTMLElement;
  overlay: HTMLElement;
  painel: HTMLElement;
  /** documento mudou (final = passo de desfazer) */
  alterou(final: boolean): void;
  /** seleção, ferramenta ou definição mudou */
  atualizar(): void;
  avisar(t: string): void;
  /** simetria do ornamento aberto (prévia espelhada no desenho) */
  simetria(): Simetria;
}

export class EditorOrnamento {
  private vp: Viewport;
  private solver!: SolverEsboco;
  ed: EditorEsboco | null = null;

  private constructor(private o: OpcoesEditor) {
    this.vp = new Viewport(o.viewport);
    this.vp.definir2D(true);
    for (const p of ["XY", "XZ", "YZ"] as const) this.vp.definirVisibilidadeReferencia(p, false);
    this.svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    this.svg.setAttribute("class", "gd-espelho");
    o.viewport.after(this.svg);
  }

  /** Encadeia a prévia espelhada depois do desenho do esboço (o editor define o seu gancho ao abrir). */
  private encadear() {
    const antes = this.vp.aposDesenhar as (((() => void) & { orn?: boolean }) | null);
    if (antes?.orn) return;
    const f = Object.assign(() => {
      antes?.();
      this.espelho();
    }, { orn: true });
    this.vp.aposDesenhar = f;
  }
  private svg: SVGSVGElement;

  /** Prévia (cinza) das cópias que a simetria vai criar: o desenho completo aparece enquanto se desenha. */
  private espelho() {
    const ed = this.ed;
    if (!ed) return void (this.svg.innerHTML = "");
    const sim = this.o.simetria();
    const copias = ({ nenhuma: [], x: [[-1, 1]], y: [[1, -1]], xy: [[-1, 1], [1, -1], [-1, -1]] } as Record<Simetria, [number, number][]>)[sim];
    const ref = ed.referencial, mp = mapaPontos(ed.esb);
    let h = "";
    for (const g of ed.esb.geos) {
      if (g.construcao || g.tipo === "texto") continue;
      const pl = amostrar(g, mp, Math.PI / 24);
      for (const [sx, sy] of copias) {
        const pts = pl.map((p) => this.vp.planoParaTela(ref, p.x * sx, p.y * sy));
        h += g.tipo === "ponto"
          ? `<circle cx="${pts[0].x.toFixed(1)}" cy="${pts[0].y.toFixed(1)}" r="4"/>`
          : `<polyline points="${pts.map((q) => `${q.x.toFixed(1)},${q.y.toFixed(1)}`).join(" ")}"/>`;
      }
    }
    this.svg.innerHTML = h;
  }

  static async criar(o: OpcoesEditor): Promise<EditorOrnamento> {
    const e = new EditorOrnamento(o);
    e.solver = await SolverEsboco.criar(() => wasmPlaneGcs);
    return e;
  }

  abrir(esb: FeatureEsboco) {
    this.ed?.fechar();
    this.ed = new EditorEsboco({
      viewport: this.vp, solver: this.solver, overlay: this.o.overlay, alterou: (f) => this.o.alterou(f),
      atualizarInterface: () => { this.painel(); this.o.atualizar(); },
      avisar: this.o.avisar,
    }, esb);
    this.ed.relacoesAuto = relacoesAutoLigadas(lerPrefsCad()); // a mesma chave do esboço do WJCAD
    this.encadear();
    this.vp.olharPlano(this.ed.referencial);
    this.painel();
    this.enquadrar(esb);
  }

  fechar() {
    this.ed?.fechar();
    this.ed = null;
    this.svg.innerHTML = "";
  }

  reatar(esb: FeatureEsboco) {
    this.ed?.reatar(esb);
    this.painel();
  }

  /** Ids selecionados: entidades (fios) e pontos. */
  selecao(): string[] {
    return this.ed ? [...this.ed.selecao] : [];
  }

  teclado(e: KeyboardEvent): boolean {
    return !!this.ed?.teclado(e);
  }

  enquadrar(esb = this.ed?.esb) {
    if (!this.ed || !esb) return;
    const ref = this.ed.referencial;
    this.vp.olharPlano(ref);
    const pts = esb.pontos;
    if (!pts.length) return;
    const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
    setTimeout(() => {
      const r = this.vp.canvas().getBoundingClientRect();
      const a = this.vp.planoParaTela(ref, Math.min(...xs), Math.max(...ys));
      const b = this.vp.planoParaTela(ref, Math.max(...xs), Math.min(...ys));
      this.vp.ampliarArea(r.left + a.x - 40, r.top + a.y - 40, r.left + b.x + 40, r.top + b.y + 40);
    }, 450);
  }

  private painel() {
    const ed = this.ed;
    if (!ed) return;
    renderizarPainelEsboco(this.o.painel, ed, () => ed.definirFerramenta("selecionar"), () => {}, (ancora) => {
      const r = ancora.getBoundingClientRect();
      menu(r.left, r.bottom + 4, ed.relacoesPossiveis().map((x) => ({ rotulo: `${x.simbolo}   ${x.rotulo}`, acao: x.aplicar })));
    });
    // o ornamento sai pelo botão "Concluir" da faixa
    this.o.painel.querySelectorAll("button").forEach((b) => {
      if (b.textContent?.includes("Sair do esboço")) b.closest(".prop-rodape")?.remove();
    });
  }

  /** Faixa: a aba Sketch do WJCAD + Concluir. */
  montarFaixa(faixa: HTMLElement, concluir: () => void) {
    faixa.innerHTML = "";
    const fim = document.createElement("div");
    fim.className = "wj-grupo";
    const ok = document.createElement("button");
    ok.className = "wj-cmd gd-concluir";
    ok.innerHTML = `<span style="font-size:22px">✓</span><span>Concluir ornamento</span>`;
    ok.onclick = concluir;
    fim.append(ok);
    faixa.append(fim);
    let grupo: HTMLElement | null = null;
    let g = -1;
    for (const c of SKETCH) {
      if (c.grupo !== g || !grupo) {
        grupo = document.createElement("div");
        grupo.className = "wj-grupo";
        faixa.append(grupo);
        g = c.grupo;
      }
      if (!c.itens) {
        grupo.append(this.botao(c, faixa, concluir));
        continue;
      }
      const itens = c.itens.filter((i) => !FORA.has(i.id));
      if (!itens.length) continue;
      const b = this.botao(itens[0], faixa, concluir, c.rotulo);
      if (itens.length < 2) {
        grupo.append(b);
        continue;
      }
      const caixa = document.createElement("span");
      caixa.className = "ce-menu";
      const seta = document.createElement("button");
      seta.className = "ce-seta";
      seta.textContent = "▾";
      seta.title = `${c.rotulo}: outras opções`;
      seta.onclick = () => {
        const r = seta.getBoundingClientRect();
        menu(r.left, r.bottom + 4, itens.map((it) => ({ rotulo: `${it.rotulo}${it.emBreve ? " (em breve)" : ""}`, acao: () => this.executar(it, seta, faixa, concluir) })));
      };
      caixa.append(b, seta);
      grupo.append(caixa);
    }
  }

  private ativo(c: ComandoCad): boolean {
    const ed = this.ed;
    if (!ed) return false;
    if (c.id === "construcao") return ed.construcao;
    const [f, v] = c.id.split(":");
    return f === ed.ferramenta && (!v || ed.variante(f) === v);
  }

  private botao(c: ComandoCad, faixa: HTMLElement, concluir: () => void, rotulo = c.rotulo): HTMLButtonElement {
    const b = document.createElement("button");
    b.className = "wj-cmd";
    b.title = c.emBreve ? `${c.dica} — em breve` : c.dica;
    b.innerHTML = `${ICONES[c.icone] ?? ""}<span>${escapar(rotulo)}</span>`;
    if (c.emBreve) b.setAttribute("aria-disabled", "true");
    b.setAttribute("aria-pressed", String(this.ativo(c)));
    b.onclick = () => this.executar(c, b, faixa, concluir);
    return b;
  }

  private executar(c: ComandoCad, botao: HTMLElement, faixa: HTMLElement, concluir: () => void) {
    const ed = this.ed;
    if (!ed) return;
    if (c.emBreve) return this.o.avisar(`${c.rotulo}: em breve.`);
    switch (c.id) {
      case "relacao": {
        const ops = ed.relacoesPossiveis();
        if (!ops.length) return this.o.avisar("Selecione entidades para relacionar (ex.: duas linhas → Paralelo).");
        const r = botao.getBoundingClientRect();
        return menu(r.left, r.bottom + 4, ops.map((o) => ({ rotulo: `${o.simbolo}   ${o.rotulo}`, acao: o.aplicar })));
      }
      case "construcao":
        if (ed.geosSelecionadas().length) ed.alternarConstrucaoSelecao();
        else {
          ed.construcao = !ed.construcao;
          this.o.avisar(ed.construcao ? "Próximas entidades serão de construção (guias: não viram fio)." : "Próximas entidades serão fios.");
        }
        break;
      case "espelhoDinamico":
        ed.alternarEspelhoDinamico();
        break;
      case "selecionarTudo":
        ed.selecionarTudo();
        break;
      case "exibirRelacoes":
      case "padraoLinearEsboco":
      case "padraoCircularEsboco":
        ed.definirFerramenta(c.id as Ferramenta);
        break;
      default: {
        const [f, v] = c.id.split(":") as [Ferramenta, string | undefined];
        if (v) ed.definirVariante(f, v);
        ed.definirFerramenta(f);
      }
    }
    this.montarFaixa(faixa, concluir);
  }
}
