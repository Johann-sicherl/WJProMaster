// WJSlicer3D: desenho do painel de processo GERADO do esquema (fatia L1b). Uma função de desenho só para as seis abas:
// grupos recolhíveis, selo de estado ✅🟡🔶, busca, nível (Simples/Avançado/Especialista) e ↺ por campo.
// Só a aba aberta é desenhada; a lógica (o que aparece, texto ↔ valor, ↺) é de painel.ts (puro, testado em Node).

import { escapar } from "../comum/casca";
import { NOMES_ABAS, type Aba, type Campo, type Nivel, type Plano, type Valor } from "./esquema";
import { NIVEIS, NOMES_NIVEIS, SELOS, alterados, buscarCampos, camposDoPainel, grupoComecaAberto, gruposDoPainel, limitesDaCaixa, textoParaValor, valorParaTexto, visivelAgora, type GrupoPainel } from "./painel";

export interface DepsPainel {
  /** valores de agora (todos os campos) */
  valores(): Plano;
  /** valores do perfil escolhido (para o ↺) */
  perfil(): Plano;
  /** um campo mudou na tela */
  aoMudar(id: string, v: Valor): void;
  /** ↺: volta estes campos ao valor do perfil */
  aoVoltar(ids: string[]): void;
  /** o nível (Simples/Avançado/Especialista) mudou */
  aoNivel(n: Nivel): void;
}

const idSeguro = (id: string) => id.replace(/\./g, "-");
/** campos que ficam melhor com deslizante (percentual de uso corrente) */
const COM_DESLIZANTE = new Set(["preenchimento"]);

export function criarPainel(deps: DepsPainel, nivelInicial: Nivel) {
  const corpo = document.getElementById("sl-painel-campos") as HTMLElement;
  const abas = document.getElementById("sl-pabs") as HTMLElement;
  const busca = document.getElementById("sl-busca") as HTMLInputElement;
  const seg = document.getElementById("sl-nivel") as HTMLElement;
  let aba: Aba = "qualidade";
  let nivel: Nivel = nivelInicial;
  /** grupos abertos/recolhidos pelo usuário (chave aba/grupo); o que falta segue a regra de abrir quando há campo Simples */
  const abertos = new Map<string, boolean>();

  const consulta = () => busca.value.trim();

  function selo(c: Campo): string {
    if (c.estado === "oculto") return "";
    const s = SELOS[c.estado];
    return `<i class="sl-selo sl-selo-${c.estado}" title="${escapar(s.titulo)}" aria-label="${escapar(s.titulo)}">${s.glifo}</i>`;
  }

  function controle(c: Campo, v: Valor | undefined): string {
    const dc = `data-campo="${escapar(c.id)}"`;
    const rot = `${escapar(c.rotulo)} ${selo(c)}`;
    const nota = c.nota ? `<small class="sl-nota">${escapar(c.nota)}</small>` : "";
    let miolo: string;
    if (c.tipo === "booleano") {
      miolo = `<label class="sl-chave"><input type="checkbox" ${dc} ${v ? "checked" : ""} /> <span>${rot}</span></label>`;
    } else if (c.tipo === "lista" || c.tipo === "padrao") {
      const ops = (c.tipo === "padrao" ? c.opcoes! : c.opcoes ?? []).map(([o, n]) => `<option value="${escapar(o)}" ${o === v ? "selected" : ""}>${escapar(n)}</option>`).join("");
      miolo = `<label class="sl-campo"><span class="sl-rot">${rot}</span><select ${dc}>${ops}</select></label>`;
    } else if (c.tipo === "texto") {
      miolo = `<label class="sl-campo"><span class="sl-rot">${rot}</span>${c.id === "observacoes" ? `<textarea rows="3" ${dc}>${escapar(String(v ?? ""))}</textarea>` : `<input type="text" ${dc} value="${escapar(String(v ?? ""))}" />`}</label>`;
    } else if (COM_DESLIZANTE.has(c.id)) {
      miolo = `<label class="sl-campo"><span class="sl-rot">${rot}</span><span class="sl-faixa-valor"><input type="range" min="0" max="100" step="1" ${dc} value="${valorParaTexto(c, v)}" /><b class="sl-faixa-v">${valorParaTexto(c, v)}%</b></span></label>`;
    } else {
      const { min, max } = limitesDaCaixa(c);
      const lim = `${min !== undefined ? ` min="${min}"` : ""}${max !== undefined ? ` max="${max}"` : ""}`;
      const campo = `<input type="number" step="any" inputmode="${c.tipo === "inteiro" ? "numeric" : "decimal"}" ${dc}${lim} value="${valorParaTexto(c, v)}" />`;
      const un = c.unidade ? `<span class="unidade">${escapar(c.unidade)}</span>` : "";
      miolo = c.tipo === "inteiro"
        ? `<div class="sl-campo"><span class="sl-rot">${rot}</span><div class="sl-passo"><button type="button" data-passo="-1" aria-label="Menos: ${escapar(c.rotulo)}">−</button>${campo}<button type="button" data-passo="1" aria-label="Mais: ${escapar(c.rotulo)}">+</button></div></div>`
        : `<label class="sl-campo"><span class="sl-rot">${rot}</span><span class="sl-entrada">${campo}${un}</span></label>`;
    }
    return `<div class="sl-cp" data-id="${escapar(c.id)}" id="sl-cp-${idSeguro(c.id)}"><div class="sl-linha-cp">${miolo}<button type="button" class="sl-voltar" data-voltar="${escapar(c.id)}" hidden aria-label="Voltar ao valor do perfil: ${escapar(c.rotulo)}" title="Alterado: voltar ao perfil">↺</button></div>${nota}</div>`;
  }

  function desenharGrupo(g: GrupoPainel, valores: Plano, comAba: boolean): string {
    const chave = `${g.aba}/${g.nome}`;
    const aberto = consulta() ? true : abertos.get(chave) ?? grupoComecaAberto(g);
    const titulo = comAba ? `${NOMES_ABAS[g.aba]} › ${g.nome}` : g.nome;
    return `<details class="sl-grupo" data-grupo="${escapar(chave)}" ${aberto ? "open" : ""}><summary><span>${escapar(titulo)}</span><i class="sl-grupo-alt" hidden title="Tem campo alterado">↺</i></summary>${g.campos.map((c) => controle(c, valores[c.id])).join("")}</details>`;
  }

  /** Desenha a aba aberta (ou o resultado da busca). */
  function redesenhar() {
    const valores = deps.valores();
    const q = consulta();
    const grupos = q ? buscarCampos(q) : gruposDoPainel(aba, nivel);
    const vazio = q
      ? `Nenhum parâmetro encontrado para “${escapar(q)}”.`
      : `Nada em ${NOMES_ABAS[aba]} neste nível. Use <b>Avançado</b> ou <b>Especialista</b> para ver mais.`;
    corpo.innerHTML = (q ? `<p class="sl-nota">Resultado da busca em todas as abas e níveis.</p>` : "") + (grupos.length ? grupos.map((g) => desenharGrupo(g, valores, !!q)).join("") : `<p class="sl-nota sl-vazio-painel">${vazio}</p>`);
    for (const t of abas.querySelectorAll<HTMLElement>("[data-pab]")) t.setAttribute("aria-selected", String(!q && t.dataset.pab === aba));
    for (const b of seg.querySelectorAll<HTMLElement>("[data-nivel]")) b.setAttribute("aria-pressed", String(b.dataset.nivel === nivel));
    atualizar();
  }

  /** Só os selos ↺, as condições "visível se" e a marca das abas (depois de cada edição; sem redesenhar). */
  function atualizar(): string[] {
    const valores = deps.valores(), perfil = deps.perfil();
    const alt = alterados(perfil, valores);
    const altSet = new Set(alt);
    for (const cp of corpo.querySelectorAll<HTMLElement>(".sl-cp")) {
      const id = cp.dataset.id!;
      const c = camposPorId.get(id)!;
      cp.hidden = !visivelAgora(c, valores);
      cp.querySelector<HTMLElement>("[data-voltar]")!.hidden = !altSet.has(id);
    }
    for (const g of corpo.querySelectorAll<HTMLElement>(".sl-grupo")) {
      g.hidden = ![...g.querySelectorAll<HTMLElement>(".sl-cp")].some((cp) => !cp.hidden);
      g.querySelector<HTMLElement>(".sl-grupo-alt")!.hidden = !g.querySelector(".sl-voltar:not([hidden])");
    }
    const abasAlt = new Set(alt.map((id) => camposPorId.get(id)?.aba));
    for (const t of abas.querySelectorAll<HTMLElement>("[data-pab]")) t.classList.toggle("alterada", abasAlt.has(t.dataset.pab as Aba));
    return alt;
  }

  const camposPorId = new Map(camposDoPainel().map((c) => [c.id, c]));

  // ---- eventos (um só ouvinte por tipo, no corpo) ----
  function lerControle(el: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement): Valor | undefined {
    const c = camposPorId.get(el.dataset.campo!)!;
    if (el instanceof HTMLInputElement && el.type === "checkbox") return el.checked;
    if (c.tipo === "lista" || c.tipo === "padrao") return el.value;
    return textoParaValor(c, el.value);
  }

  corpo.addEventListener("change", (e) => {
    const el = e.target as HTMLInputElement;
    if (!el.dataset?.campo) return;
    const v = lerControle(el);
    const c = camposPorId.get(el.dataset.campo)!;
    if (v === undefined) {
      el.value = valorParaTexto(c, deps.valores()[c.id]); // texto inválido: volta ao valor de agora
      return;
    }
    if (el.type === "number") el.value = valorParaTexto(c, v); // mostra o valor já ajustado aos limites
    deps.aoMudar(c.id, v);
    atualizar();
  });
  corpo.addEventListener("input", (e) => {
    const el = e.target as HTMLInputElement;
    if (el.type !== "range" || !el.dataset?.campo) return;
    const c = camposPorId.get(el.dataset.campo)!;
    const v = textoParaValor(c, el.value);
    el.parentElement!.querySelector(".sl-faixa-v")!.textContent = `${el.value}%`;
    if (v !== undefined) deps.aoMudar(c.id, v);
    atualizar();
  });
  corpo.addEventListener("click", (e) => {
    const alvo = e.target as HTMLElement;
    const volta = alvo.closest<HTMLElement>("[data-voltar]");
    if (volta) {
      deps.aoVoltar([volta.dataset.voltar!]);
      redesenhar();
      return;
    }
    const passo = alvo.closest<HTMLElement>("[data-passo]");
    if (passo) {
      const inp = passo.parentElement!.querySelector<HTMLInputElement>("input")!;
      const c = camposPorId.get(inp.dataset.campo!)!;
      const v = textoParaValor(c, String((Number(inp.value) || 0) + Number(passo.dataset.passo)));
      if (v === undefined) return;
      inp.value = valorParaTexto(c, v);
      deps.aoMudar(c.id, v);
      atualizar();
    }
  });
  // lembra grupos abertos/recolhidos (toggle não borbulha: captura)
  corpo.addEventListener("toggle", (e) => {
    const d = e.target as HTMLDetailsElement;
    if (d.classList?.contains("sl-grupo") && !consulta()) abertos.set(d.dataset.grupo!, d.open);
  }, true);

  abas.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>("[data-pab]");
    if (!b) return;
    aba = b.dataset.pab as Aba;
    busca.value = "";
    redesenhar();
  });
  seg.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>("[data-nivel]");
    if (!b) return;
    nivel = b.dataset.nivel as Nivel;
    deps.aoNivel(nivel);
    redesenhar();
  });
  let esperaBusca = 0;
  busca.addEventListener("input", () => {
    clearTimeout(esperaBusca);
    esperaBusca = window.setTimeout(redesenhar, 120);
  });
  // chips do nível
  seg.innerHTML = NIVEIS.map((n) => `<button type="button" data-nivel="${n}" aria-pressed="${n === nivel}">${NOMES_NIVEIS[n]}</button>`).join("");

  return {
    redesenhar,
    atualizar,
    /** vai para uma aba do processo (e limpa a busca) */
    irParaAba(a: Aba) {
      aba = a;
      busca.value = "";
      redesenhar();
    },
  };
}
