// WJSlicer3D — telas do orçamento: Biblioteca de custos, Orçamento (linhas da impressão + itens da biblioteca, lucro por
// linha, totais, faixas da matriz) e Proposta comercial (gera o documento no WJWrite). O cálculo fica em orcamento.ts
// (puro, testado); aqui só há tela, cofre e DOM. A biblioteca é UM arquivo no cofre ("Biblioteca de custos.wjcus",
// pasta Impressão 3D), igual em todos os aparelhos; o orçamento fica no projeto (.wjslc) e no aparelho.

import { escapar, janela } from "../comum/casca";
import { Armazem } from "../comum/armazem";
import { abrirArquivoPorId, exportarComo, gravarArquivoFixo, lerArquivoFixo } from "../comum/cofre";
import { pegar } from "../comum/transferir";
import { gerarDocx, htmlParaBlocos } from "../documento/docx";
import {
  adicionarItem, bibliotecaPadrao, buscarItens, calcular, CATEGORIAS, completarComPadrao, contaDaLinha, converterHoras, definirAtivo, duplicarItem, editarItem, empacotarBiblioteca,
  importarDoErp, incluirItem, lerBiblioteca, lucroEmTodas, mudarLinha, NOME_BIBLIOTECA, NOMES_CATEGORIA, normalizarOrcamento, orcamentoVazio, ratear, removerLinha,
  sincronizarImpressao, tabelaFaixas, trocarItemDaLinha, validarItem, type Biblioteca, type Categoria, type DadosImpressao, type ItemCusto, type ItemDoErp, type Orcamento,
} from "./orcamento";
import { formatarReais, montarProposta, proposta0, totalDaProposta, type DadosProposta } from "./proposta";

export interface PecaProposta {
  nome: string;
  copias: number;
  /** volume (mm³): usado para ratear o valor entre as peças */
  peso: number;
  /** vista isométrica (data URL JPEG) */
  isometrica: () => string | null;
}

export interface ContextoOrcamento {
  /** filamento por cor e horas da mesa, da última fatiada (null sem peça) */
  impressao: () => DadosImpressao | null;
  pecas: () => PecaProposta[];
  /** texto para preencher "Cores" e "Material" da proposta */
  resumo: () => { cores: string; material: string; dimensoes: string };
  avisar: (msg: string, ms?: number) => void;
  /** onde as telas (orçamento e biblioteca) se abrem; sem isso, por cima da página inteira (Bancada do WJSlicer3D passa a aba) */
  raiz?: () => HTMLElement;
}

const CHAVE_ORC = "wjslicer:orcamento";
const CHAVE_BIB = "wjslicer:biblioteca";
const CHAVE_PROP = "wjslicer:proposta";
const CHAVE_LOGO = "wjslicer:logo";

const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const n2 = (v: number) => v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const n3 = (v: number) => v.toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 3 });
const pct = (v: number) => `${v.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} %`;
const lerNum = (t: string | undefined | null) => {
  const x = Number(String(t ?? "").trim().replace(/\./g, (m, i, s) => (s.includes(",") ? "" : m)).replace(",", "."));
  return Number.isFinite(x) ? x : NaN;
};
const guardarLocal = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* sem espaço: segue sem guardar */
  }
};
const lerLocal = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};

export function iniciarOrcamento(ctx: ContextoOrcamento) {
  let biblioteca: Biblioteca = (() => {
    try {
      const t = lerLocal(CHAVE_BIB);
      return t ? completarComPadrao(lerBiblioteca(t)) : { ...bibliotecaPadrao(), mod: "" };
    } catch {
      // sem cópia aceitável neste aparelho: a de fábrica é "mais antiga" que qualquer uma do cofre
      return { ...bibliotecaPadrao(), mod: "" };
    }
  })();
  let orc: Orcamento = (() => {
    try {
      return normalizarOrcamento(JSON.parse(lerLocal(CHAVE_ORC) ?? "null"));
    } catch {
      return orcamentoVazio();
    }
  })();
  let estadoBiblioteca = "";
  let telaBiblioteca: HTMLElement | null = null;
  let telaOrcamento: HTMLElement | null = null;
  let redesenharOrc: (() => void) | null = null;
  let redesenharBib: (() => void) | null = null;

  const guardarOrc = () => guardarLocal(CHAVE_ORC, JSON.stringify(orc));
  const definir = (o: Orcamento) => {
    orc = o;
    guardarOrc();
  };

  // ---------- biblioteca no cofre ----------

  let fila: Promise<unknown> = Promise.resolve();
  function mostrarEstado(t: string) {
    estadoBiblioteca = t;
    const e = telaBiblioteca?.querySelector("[data-estado]");
    if (e) e.textContent = t;
  }

  /** Grava a biblioteca no cofre (um arquivo só, publicado, para todas as cópias). */
  function salvarBiblioteca() {
    guardarLocal(CHAVE_BIB, empacotarBiblioteca(biblioteca));
    mostrarEstado("Salvando no cofre…");
    fila = fila.then(async () => {
      try {
        const r = await gravarArquivoFixo("slicer", NOME_BIBLIOTECA, new Blob([empacotarBiblioteca(biblioteca)], { type: "application/json" }), { semVersoes: true });
        mostrarEstado(/NÃO chegou|não exportado/.test(r.mensagem) ? `⚠ Salva neste aparelho. ${r.mensagem.replace(/^✓ Exportado: [^.]*\.\w+ \(versão \d+\)\. /, "")}` : "✓ Salva no cofre (igual em todos os aparelhos)");
      } catch (e) {
        mostrarEstado(`⚠ Não foi possível gravar no cofre: ${(e as Error).message}. Fica salva neste aparelho.`);
      }
    });
    return fila;
  }

  /** Lê a biblioteca do cofre: a mais recente (cofre ou aparelho) vale; se o cofre ainda não tem, cria. */
  async function carregarBiblioteca() {
    try {
      const r = await lerArquivoFixo("slicer", NOME_BIBLIOTECA);
      if (!r) {
        if (!biblioteca.mod) biblioteca = { ...biblioteca, mod: new Date().toISOString() };
        await salvarBiblioteca();
        return;
      }
      const doCofre = completarComPadrao(lerBiblioteca(r.texto));
      if (doCofre.mod >= biblioteca.mod) {  // a mais recente vale (aparelho sem cópia = mod vazio: o cofre vence)
        biblioteca = doCofre;
        guardarLocal(CHAVE_BIB, empacotarBiblioteca(biblioteca));
        mostrarEstado("✓ Biblioteca do cofre");
      } else await salvarBiblioteca();
      redesenharBib?.();
      redesenharOrc?.();
    } catch (e) {
      mostrarEstado(`⚠ Cofre indisponível (${(e as Error).message}): usando a cópia deste aparelho.`);
    }
  }

  // ---------- janelas de apoio ----------

  const opcoesCategoria = (sel?: string, todas = false) =>
    `${todas ? `<option value="">Todas as categorias</option>` : ""}${CATEGORIAS.map((c) => `<option value="${c}"${c === sel ? " selected" : ""}>${NOMES_CATEGORIA[c]}</option>`).join("")}`;

  /** Janela de item: incluir ou editar. */
  function dialogoItem(atual?: ItemCusto) {
    const j = janela(
      atual ? "Editar item" : "Novo item da biblioteca",
      `<div class="or-form">
        <label class="sl-campo">Categoria <select data-f="categoria">${opcoesCategoria(atual?.categoria ?? "material")}</select></label>
        <label class="sl-campo">Nome <input data-f="nome" value="${escapar(atual?.nome ?? "")}" autocomplete="off" /></label>
        <div class="sl-par">
          <label class="sl-campo">Unidade (kg, h, un, m…) <input data-f="unidade" value="${escapar(atual?.unidade ?? "un")}" autocomplete="off" /></label>
          <label class="sl-campo">Custo por unidade (R$) <input data-f="custo" type="number" min="0" step="any" inputmode="decimal" value="${atual?.custo ?? 0}" /></label>
        </div>
        <label class="sl-campo">Lucro padrão (%) <input data-f="lucro" type="number" min="0" step="any" inputmode="decimal" value="${atual?.lucro ?? 0}" /></label>
        ${atual?.codigo ? `<p class="sl-nota">Item do WJERP, código <b>${escapar(atual.codigo)}</b>: o custo é atualizado de lá em "Importar do WJERP".</p>` : ""}
        <p class="or-erro" data-erro hidden></p>
      </div>`,
      [
        { rotulo: "Cancelar" },
        {
          rotulo: "Salvar", destaque: true,
          acao: (c) => {
            const v = (f: string) => c.querySelector<HTMLInputElement | HTMLSelectElement>(`[data-f="${f}"]`)!.value;
            const novo = { categoria: v("categoria") as Categoria, nome: v("nome"), unidade: v("unidade"), custo: lerNum(v("custo")), lucro: lerNum(v("lucro")) };
            const erro = validarItem(novo);
            if (erro) {
              const e = c.querySelector<HTMLElement>("[data-erro]")!;
              e.textContent = erro;
              e.hidden = false;
              return false;
            }
            biblioteca = atual ? editarItem(biblioteca, atual.id, novo) : incluirItem(biblioteca, novo);
            void salvarBiblioteca();
            redesenharBib?.();
          },
        },
      ],
    );
    void j;
  }

  /** Escolhe um item (e a quantidade) da biblioteca. */
  function escolherItem(titulo: string, pedirQuantidade = true, categoria: Categoria | "" = ""): Promise<{ item: ItemCusto; quantidade: number } | null> {
    return new Promise((ok) => {
      let escolhido: ItemCusto | null = null;
      let pronto = false;
      const j = janela(
        titulo,
        `<div class="or-escolher">
          <div class="or-busca"><input data-busca type="search" placeholder="Buscar item…" autocomplete="off" /><select data-cat>${opcoesCategoria(categoria, true)}</select></div>
          <ul class="or-lista" data-lista></ul>
          ${pedirQuantidade ? `<label class="sl-campo">Quantidade <input data-qtd type="number" min="0" step="any" inputmode="decimal" value="1" /><small data-un class="sl-nota"></small></label>` : ""}
          <p class="or-erro" data-erro hidden></p>
        </div>`,
        [
          { rotulo: "Cancelar" },
          {
            rotulo: pedirQuantidade ? "Adicionar" : "Usar este item", destaque: true,
            acao: (c) => {
              const q = pedirQuantidade ? lerNum(c.querySelector<HTMLInputElement>("[data-qtd]")!.value) : 1;
              if (!escolhido || !(q >= 0)) {
                const e = c.querySelector<HTMLElement>("[data-erro]")!;
                e.textContent = !escolhido ? "Toque num item da lista." : "Informe a quantidade.";
                e.hidden = false;
                return false;
              }
              pronto = true;
              ok({ item: escolhido, quantidade: q });
            },
          },
        ],
        true,
      );
      const c = j.corpo;
      const lista = c.querySelector<HTMLElement>("[data-lista]")!;
      const desenhar = () => {
        const itens = buscarItens(biblioteca, c.querySelector<HTMLInputElement>("[data-busca]")!.value, { categoria: c.querySelector<HTMLSelectElement>("[data-cat]")!.value as Categoria | "" });
        lista.innerHTML = itens.length
          ? itens.map((i) => `<li><button data-id="${i.id}" class="${escolhido?.id === i.id ? "sel" : ""}"><span><b>${escapar(i.nome)}</b><small>${NOMES_CATEGORIA[i.categoria]}</small></span><span>${brl(i.custo)}/${escapar(i.unidade)} · lucro ${pct(i.lucro)}</span></button></li>`).join("")
          : `<li class="sl-nota">Nenhum item. Inclua na "Biblioteca de custos".</li>`;
      };
      c.addEventListener("input", (e) => {
        if ((e.target as HTMLElement).matches("[data-busca]")) desenhar();
      });
      c.addEventListener("change", (e) => {
        if ((e.target as HTMLElement).matches("[data-cat]")) desenhar();
      });
      lista.addEventListener("click", (e) => {
        const b = (e.target as HTMLElement).closest<HTMLElement>("[data-id]");
        if (!b) return;
        escolhido = biblioteca.itens.find((i) => i.id === b.dataset.id) ?? null;
        const un = c.querySelector<HTMLElement>("[data-un]");
        if (un && escolhido) un.textContent = `em ${escolhido.unidade} · custo ${brl(escolhido.custo)}/${escolhido.unidade}`;
        desenhar();
        c.querySelector<HTMLInputElement>("[data-qtd]")?.focus();
      });
      desenhar();
      // fechar sem escolher (✕, Cancelar, fora da janela, Esc) devolve null
      const obs = new MutationObserver(() => {
        if (!document.body.contains(c) && !pronto) {
          obs.disconnect();
          ok(null);
        }
      });
      obs.observe(document.body, { childList: true });
    });
  }

  // ---------- tela: biblioteca de custos ----------

  function abrirBiblioteca() {
    if (telaBiblioteca) return;
    const t = document.createElement("div");
    t.className = "or-tela";
    t.innerHTML = `<header class="or-topo"><h2>Biblioteca de custos</h2><span class="or-estado" data-estado>${escapar(estadoBiblioteca)}</span><span class="or-espaco"></span>
        <button data-novo class="destaque">+ Item</button><button data-erp title="Traz do WJERP os itens com código e custo">Importar do WJERP</button><button data-fechar>Fechar</button></header>
      <div class="or-corpo"><div class="or-busca"><input data-busca type="search" placeholder="Buscar por nome, categoria, unidade ou código…" autocomplete="off" /><select data-cat>${opcoesCategoria("", true)}</select>
        <label class="sl-chave"><input data-inativos type="checkbox" /> Mostrar desativados</label></div>
        <div class="or-rolagem"><table class="wj-tabela or-tabela"><thead><tr><th>Item</th><th>Categoria</th><th>Unidade</th><th class="num">Custo por unidade</th><th class="num">Lucro padrão</th><th></th></tr></thead><tbody data-linhas></tbody></table></div>
        <p class="sl-nota">Um arquivo só no cofre (pasta Impressão 3D), igual em todos os aparelhos. Mudar um item aqui não muda orçamentos já feitos. Lucro = % sobre o custo (markup, como na MATRIZ).</p></div>`;
    (ctx.raiz?.() ?? document.body).append(t);
    telaBiblioteca = t;
    const q = <T extends HTMLElement>(s: string) => t.querySelector<T>(s)!;
    const desenhar = () => {
      const itens = buscarItens(biblioteca, q<HTMLInputElement>("[data-busca]").value, { categoria: q<HTMLSelectElement>("[data-cat]").value as Categoria | "", inativos: q<HTMLInputElement>("[data-inativos]").checked });
      q("[data-linhas]").innerHTML = itens.length
        ? itens.map((i) => `<tr data-id="${i.id}" class="${i.ativo ? "" : "off"}"><td><b>${escapar(i.nome)}</b>${i.codigo ? ` <small class="or-cod">WJERP ${escapar(i.codigo)}</small>` : ""}${i.ativo ? "" : ` <small class="or-cod">desativado</small>`}</td><td>${NOMES_CATEGORIA[i.categoria]}</td><td>${escapar(i.unidade)}</td><td class="num">${brl(i.custo)}</td><td class="num">${pct(i.lucro)}</td>
            <td class="or-acoes"><button data-a="editar">Editar</button><button data-a="duplicar">Duplicar</button><button data-a="ativo">${i.ativo ? "Desativar" : "Reativar"}</button></td></tr>`).join("")
        : `<tr><td colspan="6" class="sl-nota">Nenhum item encontrado.</td></tr>`;
    };
    redesenharBib = desenhar;
    t.addEventListener("input", (e) => {
      if ((e.target as HTMLElement).matches("[data-busca]")) desenhar();
    });
    t.addEventListener("change", (e) => {
      if ((e.target as HTMLElement).matches("[data-cat], [data-inativos]")) desenhar();
    });
    t.addEventListener("click", (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>("button");
      if (!b) return;
      if (b.hasAttribute("data-fechar")) {
        t.remove();
        telaBiblioteca = null;
        redesenharBib = null;
        redesenharOrc?.();
      } else if (b.hasAttribute("data-novo")) dialogoItem();
      else if (b.hasAttribute("data-erp")) void importarErp();
      else if (b.dataset.a) {
        const id = b.closest<HTMLElement>("[data-id]")!.dataset.id!;
        const item = biblioteca.itens.find((i) => i.id === id)!;
        if (b.dataset.a === "editar") dialogoItem(item);
        else if (b.dataset.a === "duplicar") {
          const r = duplicarItem(biblioteca, id);
          biblioteca = r.biblioteca;
          void salvarBiblioteca();
          desenhar();
          if (r.novo) dialogoItem(r.novo);
        } else {
          biblioteca = definirAtivo(biblioteca, id, !item.ativo);
          void salvarBiblioteca();
          desenhar();
        }
      }
    });
    desenhar();
    void carregarBiblioteca();
  }

  /** Itens do WJERP (cadastro de itens com código) → "Material comprado"; atualiza pelo código. */
  async function importarErp() {
    try {
      const bancos = (await (indexedDB as IDBFactory & { databases?: () => Promise<{ name?: string }[]> }).databases?.()) ?? [];
      if (bancos.length && !bancos.some((b) => b.name === "wjerp")) return ctx.avisar("O WJERP ainda não tem itens neste aparelho. Cadastre os itens com código no WJERP e importe de novo.", 7000);
      const db = await Armazem.abrir("wjerp", ["itens"]);
      const itens = (await db.todos<ItemDoErp & { id: string }>("itens")).filter((i) => i.codigo);
      const r = importarDoErp(biblioteca, itens);
      if (!itens.length) return ctx.avisar("Nenhum item com código no WJERP.", 6000);
      biblioteca = r.biblioteca;
      void salvarBiblioteca();
      redesenharBib?.();
      ctx.avisar(`WJERP: ${r.novos} item(ns) novo(s), ${r.atualizados} atualizado(s) pelo código. Itens novos entram com lucro 0 %: ajuste na lista.`, 8000);
    } catch (e) {
      ctx.avisar(`Não foi possível ler o WJERP: ${(e as Error).message}`, 7000);
    }
  }

  // ---------- tela: orçamento ----------

  /** Atualiza as linhas da impressão com o resultado da última fatiada (mantém o que foi editado). */
  function impressaoMudou() {
    const d = ctx.impressao();
    if (!d) return;
    const novo = sincronizarImpressao(orc, d, biblioteca);
    if (JSON.stringify(novo.linhas) !== JSON.stringify(orc.linhas)) {
      definir(novo);
      redesenharOrc?.();
    }
  }

  function abrirOrcamento() {
    if (telaOrcamento) return;
    const d = ctx.impressao();
    if (d) definir(sincronizarImpressao(orc, d, biblioteca));
    const t = document.createElement("div");
    t.className = "or-tela";
    (ctx.raiz?.() ?? document.body).append(t);
    telaOrcamento = t;
    const q = <T extends HTMLElement>(s: string) => t.querySelector<T>(s)!;

    const valores = () => {
      const tot = calcular(orc);
      const set = (k: string, v: string) => t.querySelectorAll<HTMLElement>(`[data-v="${k}"]`).forEach((e) => (e.textContent = v));
      for (const l of orc.linhas) {
        const c = contaDaLinha(l);
        set(`custo:${l.id}`, brl(c.custo));
        set(`preco:${l.id}`, brl(c.preco));
      }
      set("custo", brl(tot.custo));
      set("lucroBruto", brl(tot.lucroBruto));
      set("lucroLiquido", brl(tot.lucroLiquido));
      set("markup", pct(tot.markupPct));
      set("margem", pct(tot.margemPct));
      set("precoUnit", brl(tot.precoUnit));
      set("precoFinal", brl(tot.precoFinal));
      set("mesas", n3(tot.mesas));
      set("horas", `${n2(tot.horasTotais)} h`);
      set("dias", n2(tot.dias));
      set("valorHora", tot.valorHora ? brl(tot.valorHora) : "—");
    };

    const desenhar = () => {
      const tot = calcular(orc);
      const faixas = tabelaFaixas(orc);
      const temImpressao = !!ctx.impressao();
      t.innerHTML = `<header class="or-topo"><h2>Orçamento</h2><span class="or-espaco"></span><button data-bib>Biblioteca de custos</button><button data-proposta class="destaque" title="Gera a proposta comercial no WJWrite">Gerar proposta</button><button data-fechar>Fechar</button></header>
        <div class="or-corpo">
          <section class="sl-cartao or-pedido"><h2>Pedido</h2>
            <div class="or-grade">
              <label class="sl-campo">Quantidade pedida <input data-p="quantidade" type="number" min="1" step="any" inputmode="decimal" value="${orc.quantidade}" /></label>
              <label class="sl-campo">Unidades por mesa <input data-p="unidadesPorMesa" type="number" min="1" step="any" inputmode="decimal" value="${orc.unidadesPorMesa}" /></label>
              <label class="sl-campo">Oferta sobre o lucro (%) <input data-p="oferta" type="number" min="0" max="100" step="any" inputmode="decimal" value="${orc.oferta}" /></label>
              <label class="sl-campo">Horas de impressão por dia <input data-p="horasPorDia" type="number" min="1" step="any" inputmode="decimal" value="${orc.horasPorDia}" /></label>
            </div>
            <dl class="sl-dados or-resumo"><div><dt>Mesas</dt><dd data-v="mesas"></dd></div><div><dt>Horas totais</dt><dd data-v="horas"></dd></div><div><dt>Dias de produção</dt><dd data-v="dias"></dd></div><div><dt>Valor da hora</dt><dd data-v="valorHora"></dd></div></dl>
          </section>
          <section class="sl-cartao"><h2>Linhas <span class="or-btns"><button class="sl-mini" data-add>+ Item da biblioteca</button><button class="sl-mini" data-sinc ${temImpressao ? "" : "disabled"} title="Traz de novo as linhas da impressão (filamento por cor, energia e desgaste), inclusive as que foram tiradas">Atualizar da impressão</button></span></h2>
            ${temImpressao ? "" : `<p class="sl-nota">Ponha uma peça na mesa para o fatiador preencher o filamento por cor e as horas de máquina.</p>`}
            <div class="or-rolagem"><table class="wj-tabela or-tabela"><thead><tr><th>Item</th><th class="num">Quantidade</th><th class="num">Custo/un</th><th class="num">Custo</th><th class="num">Lucro %</th><th class="num">Preço</th><th></th></tr></thead><tbody>
            ${orc.linhas.length ? orc.linhas.map((l) => `<tr data-l="${l.id}"><td><b>${escapar(l.rotulo)}</b><small class="or-cod">${l.origem === "impressao" ? "impressão · " : ""}${NOMES_CATEGORIA[l.categoria]}</small></td>
              <td class="num">${l.origem === "impressao" ? `<span title="Vem do fatiador">${n3(l.quantidade)}</span>` : `<input data-c="quantidade" type="number" min="0" step="any" inputmode="decimal" value="${l.quantidade}" />`} <small>${escapar(l.unidade)}</small></td>
              <td class="num">${brl(l.custoUnit)}</td><td class="num" data-v="custo:${l.id}"></td>
              <td class="num"><input data-c="lucro" type="number" min="0" step="any" inputmode="decimal" value="${l.lucro}" aria-label="Lucro da linha, em %" /></td><td class="num" data-v="preco:${l.id}"></td>
              <td class="or-acoes"><button data-a="trocar" title="Trocar o item da biblioteca desta linha">Trocar</button><button data-a="tirar" aria-label="Tirar a linha">✕</button></td></tr>`).join("") : `<tr><td colspan="7" class="sl-nota">Sem linhas. Use "+ Item da biblioteca".</td></tr>`}
            </tbody></table></div>
            <p class="sl-nota">Custo = quantidade × custo por unidade (valores gravados neste orçamento). Lucro % = sobre o custo da linha, começa no padrão do item.</p>
          </section>
          <section class="sl-cartao or-totais"><h2>Totais</h2>
            <dl class="sl-dados"><div><dt>Custo</dt><dd data-v="custo"></dd></div><div><dt>Lucro bruto (R$)</dt><dd data-v="lucroBruto"></dd></div><div><dt>Lucro sobre o custo (markup)</dt><dd data-v="markup"></dd></div><div><dt>Lucro sobre o preço (margem)</dt><dd data-v="margem"></dd></div>
            <div><dt>Lucro líquido (depois da oferta de ${pct(orc.oferta)})</dt><dd data-v="lucroLiquido"></dd></div><div><dt>Preço de uma unidade</dt><dd data-v="precoUnit"></dd></div></dl>
            <div class="or-final"><small>Preço final do pedido</small><b data-v="precoFinal"></b></div>
          </section>
          <details class="sl-cartao sl-detalhe"><summary>Faixas de preço da matriz</summary>
            <div class="or-rolagem"><table class="wj-tabela or-tabela"><thead><tr><th>Faixa</th><th class="num">Lucro</th><th class="num">Preço de 1 un</th><th class="num">Lucro bruto/mesa</th><th class="num">Lucro líquido/mesa</th><th class="num">% matriz</th><th class="num">Valor do pedido</th><th class="num">Valor/hora</th><th></th></tr></thead><tbody>
            ${faixas.map((f, i) => `<tr><td>${f.nome} <small class="or-cod">× ${n2(f.fator)}</small></td><td class="num">${pct(f.lucroPct)}</td><td class="num">${brl(f.precoUnit)}</td><td class="num">${brl(f.lucroBruto / (tot.mesas || 1))}</td><td class="num">${brl(f.lucroLiquido / (tot.mesas || 1))}</td><td class="num">${pct(f.pctMatriz * 100)}</td><td class="num">${brl(f.valorPedido)}</td><td class="num">${f.valorHora ? brl(f.valorHora) : "—"}</td><td><button class="sl-mini" data-faixa="${i}" title="Põe este lucro em todas as linhas">Usar</button></td></tr>`).join("")}
            </tbody></table></div>
            <p class="sl-nota">Cada faixa é o custo × o fator da matriz (1,8 = lucro de 80 % sobre o custo). "% matriz" é a coluna da planilha: lucro líquido ÷ preço da faixa Variável. "Usar" aplica o lucro da faixa em todas as linhas.</p>
          </details>
          <details class="sl-cartao sl-detalhe"><summary>Conversor de horas</summary>
            <div class="or-grade"><label class="sl-campo">Dias <input data-conv="d" type="number" min="0" step="any" inputmode="decimal" value="0" /></label><label class="sl-campo">Horas <input data-conv="h" type="number" min="0" step="any" inputmode="decimal" value="0" /></label>
            <div class="sl-campo">Total em horas<b data-conv-total class="or-grande">0 h</b></div></div>
          </details>
        </div>`;
      valores();
    };
    redesenharOrc = desenhar;
    desenhar();

    const atualizarConversor = () => {
      const dd = lerNum(q<HTMLInputElement>("[data-conv='d']").value) || 0;
      const hh = lerNum(q<HTMLInputElement>("[data-conv='h']").value) || 0;
      q("[data-conv-total]").textContent = `${n2(converterHoras(dd, hh))} h`;
    };

    t.addEventListener("change", (e) => {
      const x = e.target as HTMLInputElement;
      if (x.matches("[data-conv]")) return atualizarConversor();
      if (x.dataset.p) {
        const v = lerNum(x.value);
        if (!(v >= 0)) return desenhar();
        const o = normalizarOrcamento({ ...orc, [x.dataset.p]: v });
        const dd = ctx.impressao();
        definir(dd ? sincronizarImpressao(o, dd, biblioteca) : o);
        return desenhar();
      }
      if (x.dataset.c) {
        const id = x.closest<HTMLElement>("[data-l]")!.dataset.l!;
        const v = lerNum(x.value);
        if (!(v >= 0)) return desenhar();
        definir(mudarLinha(orc, id, { [x.dataset.c]: v }));
        valores();
      }
    });
    t.addEventListener("input", (e) => {
      const x = e.target as HTMLInputElement;
      if (x.dataset.conv) atualizarConversor();
    });
    t.addEventListener("click", async (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>("button");
      if (!b) return;
      if (b.hasAttribute("data-fechar")) {
        t.remove();
        telaOrcamento = null;
        redesenharOrc = null;
      } else if (b.hasAttribute("data-bib")) abrirBiblioteca();
      else if (b.hasAttribute("data-proposta")) void abrirProposta();
      else if (b.hasAttribute("data-add")) {
        const r = await escolherItem("Adicionar item da biblioteca");
        if (r) {
          definir(adicionarItem(orc, r.item, r.quantidade));
          desenhar();
        }
      } else if (b.hasAttribute("data-sinc")) {
        const dd = ctx.impressao();
        if (dd) {
          definir(sincronizarImpressao(orc, dd, biblioteca, true));
          desenhar();
        }
      } else if (b.dataset.faixa) {
        definir(lucroEmTodas(orc, tabelaFaixas(orc)[Number(b.dataset.faixa)].lucroPct));
        desenhar();
      } else if (b.dataset.a) {
        const id = b.closest<HTMLElement>("[data-l]")!.dataset.l!;
        if (b.dataset.a === "tirar") {
          definir(removerLinha(orc, id));
          desenhar();
        } else {
          const linha = orc.linhas.find((l) => l.id === id)!;
          const r = await escolherItem(`Trocar o item de “${linha.rotulo}”`, false, linha.categoria);
          if (r) {
            definir(trocarItemDaLinha(orc, id, r.item));
            desenhar();
          }
        }
      }
    });
  }

  // ---------- proposta comercial ----------

  interface VistaCad {
    nome: string;
    peca: string;
    url: string;
  }

  async function abrirProposta() {
    const pecas = ctx.pecas();
    if (!pecas.length) return ctx.avisar("Ponha uma peça na mesa (STL ou WJCAD) para gerar a proposta com as imagens.", 6000);
    const tot = calcular(orc);
    ctx.avisar("Gerando a vista isométrica de cada peça…", 4000);
    await new Promise((r) => setTimeout(r, 30));
    const isos = pecas.map((p) => {
      try {
        return p.isometrica();
      } catch {
        return null;
      }
    });
    const vistas = (await pegar<VistaCad[]>("slicer:vistas", false).catch(() => null)) ?? [];
    const base = proposta0();
    let lembrado: Partial<DadosProposta> = {};
    try {
      lembrado = JSON.parse(lerLocal(CHAVE_PROP) ?? "{}");
    } catch {
      /* sem memória */
    }
    const resumo = ctx.resumo();
    const dias = Math.max(1, Math.ceil(tot.dias));
    const qtds = pecas.map((p) => Math.max(1, Math.round(p.copias * Math.max(1, tot.mesas))));
    const partes = ratear(tot.precoFinal, pecas.map((p, i) => Math.max(1, p.peso) * qtds[i]));
    const precos = partes.map((v, i) => Math.round((v / qtds[i]) * 100) / 100);
    const logo = lerLocal(CHAVE_LOGO) ?? "";
    const campo = (rotulo: string, f: string, valor: string, tipo = "text", extra = "") => `<label class="sl-campo">${rotulo}<input data-f="${f}" type="${tipo}" value="${escapar(valor)}" ${extra} autocomplete="off" /></label>`;
    const j = janela(
      "Proposta comercial",
      `<div class="or-proposta">
        <p class="sl-nota">Modelo da proposta do Johann: cliente, produto, investimento, entrega e imagens de cada item. O documento é salvo no cofre (Documentos › Propostas) e abre no WJWrite, onde sai em PDF ou DOCX.</p>
        <h3>Emissor</h3>
        <div class="or-grade">${campo("Nome do emissor", "emissor", lembrado.emissor ?? "")}${campo("Data", "data", base.data)}</div>
        <label class="sl-campo">Logotipo ou QR do emissor (opcional, fica neste aparelho) <input data-logo type="file" accept="image/png,image/jpeg" /></label>
        <p class="sl-nota" data-logo-info>${logo ? "Logotipo guardado neste aparelho (vai no alto da proposta)." : "Sem logotipo."} ${logo ? `<button type="button" class="sl-mini" data-logo-tirar>Tirar</button>` : ""}</p>
        <h3>Dados do cliente</h3>
        <div class="or-grade">${campo("Nome / Empresa", "cNome", "")}${campo("Telefone", "cTelefone", "")}${campo("Endereço", "cEndereco", "")}${campo("Bairro", "cBairro", "")}${campo("Cidade", "cCidade", "")}</div>
        <h3>Produto / serviço</h3>
        <label class="sl-campo">Descritivo<textarea data-f="descritivo" rows="3"></textarea></label>
        <div class="or-grade">${campo("Dimensões", "dimensoes", resumo.dimensoes || "N/A")}${campo("Cores", "cores", resumo.cores)}${campo("Material", "material", resumo.material)}</div>
        <label class="sl-campo">Observações<textarea data-f="obs" rows="2"></textarea></label>
        <h3>Investimento e entrega</h3>
        <label class="sl-campo">Forma de pagamento<input data-f="pagamento" value="${escapar(lembrado.pagamento ?? base.pagamento)}" autocomplete="off" /></label>
        <div class="or-grade">${campo("Prazo", "prazo", `${dias} dia${dias > 1 ? "s" : ""} úteis`)}${campo("Local de entrega", "local", lembrado.local ?? base.local)}</div>
        <h3>Itens e imagens</h3>
        <div data-itens>${pecas
          .map(
            (p, i) => `<div class="or-item" data-i="${i}"><div class="or-grade"><label class="sl-campo">Item<input data-it="nome" value="${escapar(p.nome)}" autocomplete="off" /></label>
              <label class="sl-campo">Quantidade<input data-it="qtd" type="number" min="1" step="1" inputmode="numeric" value="${qtds[i]}" /></label>
              <label class="sl-campo">Preço de 1 un (R$)<input data-it="preco" type="number" min="0" step="any" inputmode="decimal" value="${precos[i]}" /></label></div>
              <div class="or-imgs">${isos[i] ? `<label class="or-img"><img src="${isos[i]}" alt="Vista isométrica de ${escapar(p.nome)}" /><span><input type="checkbox" data-img="iso" checked /> Vista isométrica</span></label>` : `<span class="sl-nota">Não foi possível gerar a vista isométrica.</span>`}
              ${vistas.map((v, k) => `<label class="or-img"><img src="${v.url}" alt="${escapar(v.nome)}" /><span><input type="checkbox" data-img="cad:${k}" ${v.peca === p.nome ? "checked" : ""} /> ${escapar(v.nome)}</span></label>`).join("")}</div></div>`,
          )
          .join("")}</div>
        ${vistas.length ? "" : `<p class="sl-nota">Vistas do WJCAD: no WJCAD, gire a peça como quiser e use o menu → "Guardar esta vista para a proposta"; elas aparecem aqui para escolher.</p>`}
        <div class="or-final or-final-prop"><small>Valor total da proposta</small><b data-total></b><small data-confere></small></div>
        <p class="or-erro" data-erro hidden></p>
        <div class="or-acoes-prop"><button class="destaque" data-gerar>Gerar proposta no WJWrite</button><button data-docx hidden>Exportar DOCX</button><button data-abrir hidden>Abrir no WJWrite</button></div>
        <p class="sl-nota" data-resultado></p>
      </div>`,
      [{ rotulo: "Fechar" }],
      true,
    );
    const c = j.corpo;
    const f = (k: string) => c.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[data-f="${k}"]`)!;
    const coletar = (): DadosProposta => {
      const d = proposta0();
      d.emissor = f("emissor").value;
      d.data = f("data").value;
      d.cliente = { nome: f("cNome").value, endereco: f("cEndereco").value, bairro: f("cBairro").value, cidade: f("cCidade").value, telefone: f("cTelefone").value };
      d.produto = { descritivo: f("descritivo").value, dimensoes: f("dimensoes").value, cores: f("cores").value, material: f("material").value, obs: f("obs").value };
      d.pagamento = f("pagamento").value;
      d.prazo = f("prazo").value;
      d.local = f("local").value;
      d.logo = lerLocal(CHAVE_LOGO) ?? undefined;
      d.itens = [...c.querySelectorAll<HTMLElement>(".or-item")].map((el, i) => {
        const imagens: string[] = [];
        for (const k of el.querySelectorAll<HTMLInputElement>("[data-img]")) {
          if (!k.checked) continue;
          const alvo = k.dataset.img!;
          const u = alvo === "iso" ? isos[i] : vistas[Number(alvo.slice(4))]?.url;
          if (u) imagens.push(u);
        }
        const v = (s: string) => el.querySelector<HTMLInputElement>(`[data-it="${s}"]`)!.value;
        return { nome: v("nome"), quantidade: Math.max(1, Math.round(lerNum(v("qtd")) || 1)), preco: Math.max(0, lerNum(v("preco")) || 0), imagens };
      });
      return d;
    };
    const totais = () => {
      const d = coletar();
      const v = totalDaProposta(d);
      c.querySelector("[data-total]")!.textContent = formatarReais(v);
      const dif = Math.round((v - tot.precoFinal) * 100) / 100;
      c.querySelector("[data-confere]")!.textContent = dif === 0 ? "igual ao preço final do orçamento" : `diferença de ${formatarReais(Math.abs(dif))} ${dif > 0 ? "acima" : "abaixo"} do preço final do orçamento (${formatarReais(tot.precoFinal)})`;
    };
    totais();
    c.addEventListener("input", (e) => {
      if ((e.target as HTMLElement).matches("[data-it]")) totais();
    });
    c.querySelector<HTMLInputElement>("[data-logo]")!.addEventListener("change", (e) => {
      const arq = (e.target as HTMLInputElement).files?.[0];
      if (!arq) return;
      if (arq.size > 600_000) return void (c.querySelector("[data-logo-info]")!.textContent = "Imagem grande demais (máximo 600 KB).");
      const leitor = new FileReader();
      leitor.onload = () => {
        guardarLocal(CHAVE_LOGO, String(leitor.result));
        c.querySelector("[data-logo-info]")!.textContent = "Logotipo guardado neste aparelho (vai no alto da proposta).";
      };
      leitor.readAsDataURL(arq);
    });
    c.addEventListener("click", (e) => {
      if ((e.target as HTMLElement).matches("[data-logo-tirar]")) {
        try {
          localStorage.removeItem(CHAVE_LOGO);
        } catch {
          /* nada */
        }
        c.querySelector("[data-logo-info]")!.textContent = "Sem logotipo.";
      }
    });
    let salvoId = "";
    let ultimo: ReturnType<typeof montarProposta> | null = null;
    const aviso = (m: string, erro = false) => {
      const e = c.querySelector<HTMLElement>("[data-erro]")!;
      e.textContent = m;
      e.hidden = !erro || !m;
      if (!erro) c.querySelector("[data-resultado]")!.textContent = m;
    };
    c.querySelector<HTMLElement>("[data-gerar]")!.addEventListener("click", async () => {
      const d = coletar();
      if (!d.cliente.nome.trim()) return aviso("Informe o nome ou a empresa do cliente.", true);
      if (!d.itens.length || !(totalDaProposta(d) > 0)) return aviso("Informe o preço dos itens.", true);
      aviso("", true);
      guardarLocal(CHAVE_PROP, JSON.stringify({ emissor: d.emissor, pagamento: d.pagamento, local: d.local }));
      const botao = c.querySelector<HTMLButtonElement>("[data-gerar]")!;
      botao.disabled = true;
      try {
        ultimo = montarProposta(d);
        const r = await gravarArquivoFixo("word", `${ultimo.nome}.wjdoc`, new Blob([JSON.stringify(ultimo)], { type: "application/json" }), { sub: ["Propostas"] });
        salvoId = r.id;
        aviso(`✓ Proposta salva no cofre (Documentos › Propostas › ${ultimo.nome}.wjdoc). ${r.mensagem.replace(/^✓ Exportado: [^.]*\.\w+ \(versão \d+\)\. /, "")}`);
        c.querySelector<HTMLElement>("[data-abrir]")!.hidden = !salvoId;
        c.querySelector<HTMLElement>("[data-docx]")!.hidden = false;
      } catch (err) {
        aviso(`Não foi possível salvar a proposta: ${(err as Error).message}`, true);
      } finally {
        botao.disabled = false;
      }
    });
    c.querySelector<HTMLElement>("[data-abrir]")!.addEventListener("click", async () => {
      const m = await abrirArquivoPorId(salvoId);
      if (m) aviso(m, true);
    });
    c.querySelector<HTMLElement>("[data-docx]")!.addEventListener("click", async () => {
      if (!ultimo) return;
      const raiz = document.createElement("div");
      raiz.innerHTML = ultimo.html;
      const pag = { larguraMm: 210, alturaMm: 297, margens: { ...ultimo.pagina.margens } };
      try {
        aviso(await exportarComo("word", ultimo.nome, [{ ext: "docx", rotulo: "Documento DOCX (.docx)" }], async () => new Blob([gerarDocx(htmlParaBlocos(raiz, pag), pag, ultimo!.nome) as BlobPart], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" })));
      } catch (err) {
        aviso(`Não foi possível exportar o DOCX: ${(err as Error).message}`, true);
      }
    });
  }

  void carregarBiblioteca();

  return {
    abrirOrcamento, abrirBiblioteca, abrirProposta, impressaoMudou,
    obter: () => orc,
    definir: (o: Orcamento | null | undefined) => {
      orc = normalizarOrcamento(o);
      guardarOrc();
      redesenharOrc?.();
    },
    biblioteca: () => biblioteca,
  };
}
