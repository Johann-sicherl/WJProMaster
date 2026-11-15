// WJSlicer3D — biblioteca de custos e orçamento (puro, testado em scripts/teste-orcamento.ts).
//
// O cálculo segue a planilha MATRIZ_V01 do Johann ("TABELA DE PREÇOS IMPRESSÃO 3D"):
//   • o lucro é MARKUP sobre o custo: preço = custo × fator (fator 1,8 = lucro de 80 % sobre o custo);
//   • custo bruto da mesa = matéria-prima (g ÷ 1000 × R$/kg) + energia (kW × R$/kWh × h) + desgaste (R$/h × h);
//   • preço unitário = ARREDONDAR.PARA.CIMA(preço da mesa ÷ unidades por mesa, 2 casas);
//   • lucro bruto = ARREDONDAR.PARA.CIMA(preço − custo, 2 casas); lucro líquido = lucro bruto − 30 % ("oferta");
//   • valor total do pedido = preço unitário × quantidade; lucro total = líquido × quantidade ÷ unidades por mesa;
//   • valor da hora = preço da mesa ÷ horas da mesa; dias = horas totais ÷ 20 h de impressão por dia;
//   • faixas de preço: Variável 1,8 · Mínimo escala 2,5 · Mínimo 3 · Médio escala 3,5 · Médio 4 · Máximo escala 5 ·
//     Máximo 6 · Máximo hyper 8 · Máximo ultra hyper 10.
// Aqui o lucro é editável por linha (padrão = lucro do item da biblioteca); com o mesmo % em todas as linhas o
// resultado é idêntico ao da planilha. Cada orçamento guarda os valores usados (a biblioteca pode mudar depois).

export type Categoria = "material" | "mao-de-obra" | "servico" | "filamento" | "maquina";
export const CATEGORIAS: Categoria[] = ["material", "mao-de-obra", "servico", "filamento", "maquina"];
export const NOMES_CATEGORIA: Record<Categoria, string> = {
  material: "Material comprado", "mao-de-obra": "Mão de obra H-H", servico: "Serviço", filamento: "Filamento", maquina: "Máquina",
};

export interface ItemCusto {
  id: string;
  categoria: Categoria;
  nome: string;
  /** kg, h, un, m… */
  unidade: string;
  /** R$ por unidade */
  custo: number;
  /** lucro padrão (markup sobre o custo, %) */
  lucro: number;
  ativo: boolean;
  /** código do item no WJERP (quando veio de lá) */
  codigo?: string;
}

export interface Biblioteca {
  formato: "wjcus";
  versao: 1;
  itens: ItemCusto[];
  mod: string;
}

export const EXTENSAO_BIBLIOTECA = "wjcus";
export const NOME_BIBLIOTECA = `Biblioteca de custos.${EXTENSAO_BIBLIOTECA}`;

const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
const agora = () => new Date().toISOString();
const num = (v: unknown, padrao = 0) => (typeof v === "number" && Number.isFinite(v) ? v : padrao);
const naoNegativo = (v: unknown, padrao = 0) => Math.max(0, num(v, padrao));
/** ARREDONDAR.PARA.CIMA(x; 2) da planilha (o arredondamento a 1e-6 evita ruído de ponto flutuante). */
export const subir2 = (x: number) => Math.ceil(Math.round(x * 1e6) / 1e4) / 100;
export const arredondar2 = (x: number) => Math.round(x * 100 + 1e-9) / 100;

/** Código dos itens de fábrica que o orçamento usa nas linhas da impressão. */
export const ID_ENERGIA = "maq-energia";
export const ID_DESGASTE = "maq-desgaste";
const FILAMENTO_DO_MATERIAL: Record<string, string> = {
  pla: "fil-pla-nacional", "pla-hs": "fil-pla-nacional", petg: "fil-petg", abs: "fil-abs", asa: "fil-abs", tpu: "fil-tpu",
};

const item = (id: string, categoria: Categoria, nome: string, unidade: string, custo: number, lucro: number): ItemCusto => ({ id, categoria, nome, unidade, custo, lucro, ativo: true });

/** Biblioteca de fábrica: preços médios da planilha (filamentos, energia e desgaste) e os exemplos do Johann. */
export function bibliotecaPadrao(): Biblioteca {
  return {
    formato: "wjcus", versao: 1, mod: agora(),
    itens: [
      item("fil-pla-nacional", "filamento", "PLA nacional", "kg", 90, 80),
      item("fil-pla-importado", "filamento", "PLA importado", "kg", 139, 80),
      item("fil-abs", "filamento", "ABS", "kg", 75, 80),
      item("fil-tpu", "filamento", "TPU", "kg", 135, 80),
      item("fil-petg", "filamento", "PETG", "kg", 100, 80),
      item("fil-resina", "filamento", "Resina", "kg", 149, 80),
      item(ID_ENERGIA, "maquina", "Energia da impressora (630 W × R$ 1,16/kWh)", "h", 0.7308, 80),
      item(ID_DESGASTE, "maquina", "Desgaste da máquina", "h", 1, 80),
      item("mo-modelagem", "mao-de-obra", "H-H Modelagem", "h", 30, 0),
      item("mat-chumbo", "material", "Chumbo", "kg", 60, 0),
      item("mat-ima-10x4", "material", "Ímã 10×4", "un", 5, 30),
    ],
  };
}

/** Texto sem acento e em minúsculas, para a busca. */
const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Itens que combinam com o texto (nome, categoria, unidade, código), ativos primeiro; `inativos` inclui os desativados. */
export function buscarItens(b: Biblioteca, texto = "", o: { categoria?: Categoria | ""; inativos?: boolean } = {}): ItemCusto[] {
  const partes = semAcento(texto).split(/\s+/).filter(Boolean);
  return b.itens
    .filter((i) => (o.inativos || i.ativo) && (!o.categoria || i.categoria === o.categoria))
    .filter((i) => {
      const alvo = semAcento(`${i.nome} ${NOMES_CATEGORIA[i.categoria]} ${i.unidade} ${i.codigo ?? ""}`);
      return partes.every((p) => alvo.includes(p));
    })
    .sort((a, b) => Number(b.ativo) - Number(a.ativo) || a.nome.localeCompare(b.nome, "pt-BR"));
}

export function validarItem(i: Partial<ItemCusto>): string | null {
  if (!i.nome?.trim()) return "Dê um nome ao item.";
  if (!i.unidade?.trim()) return "Informe a unidade (kg, h, un, m…).";
  if (!(num(i.custo, NaN) >= 0)) return "O custo por unidade precisa ser um número (0 ou mais).";
  if (!(num(i.lucro, NaN) >= 0)) return "O lucro padrão precisa ser um número (0 % ou mais).";
  if (i.categoria && !CATEGORIAS.includes(i.categoria)) return "Categoria inválida.";
  return null;
}

/** Inclui um item novo (ou troca o que tem o mesmo id). Devolve a biblioteca nova. */
export function incluirItem(b: Biblioteca, p: Partial<ItemCusto> & Pick<ItemCusto, "nome">): Biblioteca {
  const novo: ItemCusto = {
    id: p.id ?? uid(), categoria: p.categoria ?? "material", nome: p.nome.trim(), unidade: (p.unidade ?? "un").trim(), custo: naoNegativo(p.custo), lucro: naoNegativo(p.lucro),
    ativo: p.ativo ?? true, ...(p.codigo ? { codigo: p.codigo } : {}),
  };
  const itens = b.itens.some((x) => x.id === novo.id) ? b.itens.map((x) => (x.id === novo.id ? novo : x)) : [...b.itens, novo];
  return { ...b, itens, mod: agora() };
}

export function editarItem(b: Biblioteca, id: string, mudanca: Partial<Omit<ItemCusto, "id">>): Biblioteca {
  const atual = b.itens.find((x) => x.id === id);
  if (!atual) return b;
  return incluirItem(b, { ...atual, ...mudanca, id });
}

/** Cópia do item com "(cópia)" no nome (sem o código do WJERP, que é único). */
export function duplicarItem(b: Biblioteca, id: string): { biblioteca: Biblioteca; novo: ItemCusto | null } {
  const o = b.itens.find((x) => x.id === id);
  if (!o) return { biblioteca: b, novo: null };
  const nomes = new Set(b.itens.map((x) => x.nome));
  let nome = `${o.nome} (cópia)`;
  for (let n = 2; nomes.has(nome); n++) nome = `${o.nome} (cópia ${n})`;
  const novo: ItemCusto = { ...o, id: uid(), nome, codigo: undefined, ativo: true };
  delete novo.codigo;
  return { biblioteca: { ...b, itens: [...b.itens, novo], mod: agora() }, novo };
}

/** Desativar (ou reativar) tira o item da lista de escolha sem apagá-lo: orçamentos antigos não mudam de qualquer jeito. */
export const definirAtivo = (b: Biblioteca, id: string, ativo: boolean) => editarItem(b, id, { ativo });

export function empacotarBiblioteca(b: Biblioteca): string {
  return JSON.stringify(b);
}

/** Lê o texto de uma biblioteca (itens inválidos são descartados; sem itens, usa a de fábrica). */
export function lerBiblioteca(texto: string): Biblioteca {
  let j: Partial<Biblioteca>;
  try {
    j = JSON.parse(texto);
  } catch {
    throw new Error("O arquivo não é uma biblioteca de custos do WJSlicer3D.");
  }
  if (j.formato !== "wjcus" || !Array.isArray(j.itens)) throw new Error("O arquivo não é uma biblioteca de custos do WJSlicer3D.");
  const ids = new Set<string>();
  const itens: ItemCusto[] = [];
  for (const x of j.itens as Partial<ItemCusto>[]) {
    if (!x || typeof x.nome !== "string" || !x.nome.trim() || !x.id || ids.has(x.id)) continue;
    ids.add(x.id);
    itens.push({
      id: x.id, categoria: CATEGORIAS.includes(x.categoria as Categoria) ? (x.categoria as Categoria) : "material", nome: x.nome, unidade: x.unidade || "un",
      custo: naoNegativo(x.custo), lucro: naoNegativo(x.lucro), ativo: x.ativo !== false, ...(x.codigo ? { codigo: String(x.codigo) } : {}),
    });
  }
  return { formato: "wjcus", versao: 1, itens, mod: typeof j.mod === "string" ? j.mod : agora() };
}

/** Junta duas bibliotecas (a mais recente de cada item vence é decidido por quem chama; aqui: o que falta entra). */
export function completarComPadrao(b: Biblioteca): Biblioteca {
  const tem = new Set(b.itens.map((x) => x.id));
  const faltam = bibliotecaPadrao().itens.filter((x) => (x.id === ID_ENERGIA || x.id === ID_DESGASTE) && !tem.has(x.id));
  return faltam.length ? { ...b, itens: [...b.itens, ...faltam] } : b;
}

// ---------- WJERP: itens com código viram itens de "Material comprado" ----------

export interface ItemDoErp {
  codigo: string;
  descricao: string;
  unidade: string;
  preco?: number;
  custoPadrao?: number;
}

/** Atualiza (pelo código) ou inclui os itens do WJERP; o lucro dos que já existem não muda. */
export function importarDoErp(b: Biblioteca, itens: ItemDoErp[]): { biblioteca: Biblioteca; novos: number; atualizados: number } {
  let r = b, novos = 0, atualizados = 0;
  for (const e of itens) {
    const codigo = e.codigo?.trim();
    const custo = e.custoPadrao ?? e.preco;
    if (!codigo || !(typeof custo === "number" && custo > 0)) continue;
    const ja = r.itens.find((x) => x.codigo === codigo);
    if (ja) {
      if (ja.custo !== custo || ja.unidade !== (e.unidade || ja.unidade)) {
        r = editarItem(r, ja.id, { custo, unidade: e.unidade || ja.unidade });
        atualizados++;
      }
    } else {
      r = incluirItem(r, { categoria: "material", nome: e.descricao || codigo, unidade: e.unidade || "un", custo, lucro: 0, codigo });
      novos++;
    }
  }
  return { biblioteca: r, novos, atualizados };
}

// ---------- orçamento ----------

export interface LinhaOrcamento {
  id: string;
  /** "fil:0", "maq:energia"… nas linhas que vêm da impressão (o fatiador as atualiza) */
  chave?: string;
  origem: "impressao" | "biblioteca";
  itemId?: string;
  categoria: Categoria;
  rotulo: string;
  unidade: string;
  quantidade: number;
  /** valores gravados no orçamento (a biblioteca pode mudar depois) */
  custoUnit: number;
  /** lucro desta linha (markup sobre o custo, %) */
  lucro: number;
}

export interface Orcamento {
  formato: "wjorc";
  versao: 1;
  /** quantidade pedida (unidades) */
  quantidade: number;
  /** unidades que uma mesa de impressão produz */
  unidadesPorMesa: number;
  /** desconto sobre o lucro bruto ("oferta"), % */
  oferta: number;
  /** horas de impressão por dia (para os dias de produção) */
  horasPorDia: number;
  linhas: LinhaOrcamento[];
  /** linhas da impressão que o usuário tirou (não voltam sozinhas) */
  removidas: string[];
}

export const orcamentoVazio = (): Orcamento => ({ formato: "wjorc", versao: 1, quantidade: 1, unidadesPorMesa: 1, oferta: 30, horasPorDia: 20, linhas: [], removidas: [] });

/** Valida e completa um orçamento lido de arquivo. */
export function normalizarOrcamento(o: Partial<Orcamento> | null | undefined): Orcamento {
  const base = orcamentoVazio();
  if (!o || typeof o !== "object") return base;
  const linhas: LinhaOrcamento[] = [];
  for (const l of Array.isArray(o.linhas) ? o.linhas : []) {
    if (!l || typeof l.rotulo !== "string") continue;
    linhas.push({
      id: l.id || uid(), ...(l.chave ? { chave: l.chave } : {}), origem: l.origem === "impressao" ? "impressao" : "biblioteca", ...(l.itemId ? { itemId: l.itemId } : {}),
      categoria: CATEGORIAS.includes(l.categoria) ? l.categoria : "material", rotulo: l.rotulo, unidade: l.unidade || "un", quantidade: naoNegativo(l.quantidade), custoUnit: naoNegativo(l.custoUnit), lucro: naoNegativo(l.lucro),
    });
  }
  return {
    ...base, quantidade: Math.max(1, num(o.quantidade, 1)), unidadesPorMesa: Math.max(1, num(o.unidadesPorMesa, 1)), oferta: Math.min(100, naoNegativo(o.oferta, 30)),
    horasPorDia: Math.max(1, num(o.horasPorDia, 20)), linhas, removidas: Array.isArray(o.removidas) ? o.removidas.filter((x) => typeof x === "string") : [],
  };
}

/** Linha de um item da biblioteca com a quantidade (valores copiados para o orçamento). */
export function linhaDoItem(i: ItemCusto, quantidade: number, extra: Partial<LinhaOrcamento> = {}): LinhaOrcamento {
  return { id: uid(), origem: "biblioteca", itemId: i.id, categoria: i.categoria, rotulo: i.nome, unidade: i.unidade, quantidade: naoNegativo(quantidade), custoUnit: i.custo, lucro: i.lucro, ...extra };
}

export const adicionarItem = (o: Orcamento, i: ItemCusto, quantidade: number): Orcamento => ({ ...o, linhas: [...o.linhas, linhaDoItem(i, quantidade)] });

/** Troca o item de uma linha (copia nome, unidade, custo e lucro do item; a quantidade fica). */
export function trocarItemDaLinha(o: Orcamento, linhaId: string, i: ItemCusto): Orcamento {
  return { ...o, linhas: o.linhas.map((l) => (l.id === linhaId ? { ...l, itemId: i.id, categoria: i.categoria, unidade: i.unidade, custoUnit: i.custo, lucro: i.lucro, rotulo: l.chave?.startsWith("fil:") ? `${l.rotulo.split(" — ")[0]} — ${i.nome}` : i.nome } : l)) };
}

export function mudarLinha(o: Orcamento, linhaId: string, m: Partial<Pick<LinhaOrcamento, "quantidade" | "custoUnit" | "lucro" | "rotulo">>): Orcamento {
  return { ...o, linhas: o.linhas.map((l) => (l.id === linhaId ? { ...l, ...m, ...(m.quantidade !== undefined ? { quantidade: naoNegativo(m.quantidade) } : {}), ...(m.custoUnit !== undefined ? { custoUnit: naoNegativo(m.custoUnit) } : {}), ...(m.lucro !== undefined ? { lucro: naoNegativo(m.lucro) } : {}) } : l)) };
}

export function removerLinha(o: Orcamento, linhaId: string): Orcamento {
  const l = o.linhas.find((x) => x.id === linhaId);
  return { ...o, linhas: o.linhas.filter((x) => x.id !== linhaId), removidas: l?.chave && !o.removidas.includes(l.chave) ? [...o.removidas, l.chave] : o.removidas };
}

/** Define o mesmo lucro (%) em todas as linhas (usado pelas faixas de preço da matriz). */
export const lucroEmTodas = (o: Orcamento, lucro: number): Orcamento => ({ ...o, linhas: o.linhas.map((l) => ({ ...l, lucro: naoNegativo(lucro) })) });

// ---------- linhas da impressão ----------

export interface CorImpressa {
  indice: number;
  /** nome do filamento da cor no projeto */
  nome: string;
  /** material (id do perfil: pla, petg…) */
  material: string;
  /** massa desta cor, por mesa (inclui purga e torre), g */
  massaG: number;
}

export interface DadosImpressao {
  cores: CorImpressa[];
  /** tempo de impressão de uma mesa (com trocas e calibração), h */
  horasMesa: number;
}

export const mesasDoPedido = (o: Pick<Orcamento, "quantidade" | "unidadesPorMesa">) => o.quantidade / Math.max(1, o.unidadesPorMesa);

/**
 * Põe no orçamento as linhas vindas do fatiador: um filamento por cor usada (kg = massa × mesas), a energia e
 * o desgaste da máquina (h = horas da mesa × mesas). Linhas que já existem só têm a quantidade atualizada: item
 * escolhido, custo e lucro editados ficam como estão. `restaurar` traz de volta as que o usuário tirou.
 */
export function sincronizarImpressao(o: Orcamento, d: DadosImpressao, b: Biblioteca, restaurar = false): Orcamento {
  const mesas = mesasDoPedido(o);
  const removidas = restaurar ? [] : o.removidas;
  const achar = (id: string) => b.itens.find((x) => x.id === id && x.ativo) ?? b.itens.find((x) => x.id === id);
  const desejadas: { chave: string; rotulo: string; quantidade: number; padrao: ItemCusto | undefined; categoria: Categoria; unidade: string }[] = [];
  for (const c of d.cores) {
    const padrao = achar(FILAMENTO_DO_MATERIAL[c.material] ?? "fil-pla-nacional") ?? b.itens.find((x) => x.categoria === "filamento" && x.ativo);
    desejadas.push({ chave: `fil:${c.indice}`, rotulo: `Filamento cor ${c.indice + 1} — ${padrao?.nome ?? c.nome}`, quantidade: (c.massaG / 1000) * mesas, padrao, categoria: "filamento", unidade: "kg" });
  }
  const energia = achar(ID_ENERGIA), desgaste = achar(ID_DESGASTE);
  if (energia) desejadas.push({ chave: "maq:energia", rotulo: "Máquina — energia", quantidade: d.horasMesa * mesas, padrao: energia, categoria: "maquina", unidade: "h" });
  if (desgaste) desejadas.push({ chave: "maq:desgaste", rotulo: "Máquina — desgaste", quantidade: d.horasMesa * mesas, padrao: desgaste, categoria: "maquina", unidade: "h" });
  const chaves = new Set(desejadas.map((x) => x.chave));
  // as linhas da impressão que não existem mais (cor que saiu) vão embora; as demais linhas ficam
  let linhas = o.linhas.filter((l) => l.origem !== "impressao" || !l.chave || chaves.has(l.chave));
  for (const x of desejadas) {
    if (removidas.includes(x.chave)) continue;
    const i = linhas.findIndex((l) => l.chave === x.chave);
    if (i >= 0) linhas[i] = { ...linhas[i], quantidade: x.quantidade };
    else if (x.padrao) {
      const novo = linhaDoItem(x.padrao, x.quantidade, { origem: "impressao", chave: x.chave, rotulo: x.rotulo });
      // impressão primeiro: filamentos, depois máquina, antes dos itens da biblioteca
      const primeiraDaBiblioteca = linhas.findIndex((l) => l.origem === "biblioteca");
      linhas = primeiraDaBiblioteca < 0 ? [...linhas, novo] : [...linhas.slice(0, primeiraDaBiblioteca), novo, ...linhas.slice(primeiraDaBiblioteca)];
    }
  }
  return { ...o, linhas, removidas };
}

// ---------- contas ----------

export interface ContaLinha {
  custo: number;
  preco: number;
  lucro: number;
}

export interface Totais {
  /** custo bruto do pedido (soma das linhas) */
  custo: number;
  /** soma do preço das linhas (sem arredondar) */
  precoLinhas: number;
  mesas: number;
  /** preço de uma unidade (arredondado para cima, centavos) */
  precoUnit: number;
  /** valor total do pedido = preço unitário × quantidade */
  precoFinal: number;
  /** lucro bruto do pedido (arredondado para cima por mesa, como a planilha) */
  lucroBruto: number;
  /** lucro líquido: bruto − oferta */
  lucroLiquido: number;
  /** lucro bruto sobre o custo (markup), % */
  markupPct: number;
  /** lucro bruto sobre o preço final (margem), % */
  margemPct: number;
  /** horas totais de impressão e dias de produção */
  horasTotais: number;
  dias: number;
  /** preço da mesa por hora de impressão */
  valorHora: number;
}

export const contaDaLinha = (l: Pick<LinhaOrcamento, "quantidade" | "custoUnit" | "lucro">): ContaLinha => {
  const custo = l.quantidade * l.custoUnit;
  const preco = custo * (1 + l.lucro / 100);
  return { custo, preco, lucro: preco - custo };
};

/** Horas de impressão de uma mesa, tiradas das linhas "máquina" da impressão (energia). */
export function horasDaMesa(o: Orcamento): number {
  const l = o.linhas.find((x) => x.chave === "maq:energia") ?? o.linhas.find((x) => x.chave === "maq:desgaste");
  const mesas = mesasDoPedido(o);
  return l && mesas > 0 ? l.quantidade / mesas : 0;
}

export function calcular(o: Orcamento): Totais {
  let custo = 0, precoLinhas = 0;
  for (const l of o.linhas) {
    const c = contaDaLinha(l);
    custo += c.custo;
    precoLinhas += c.preco;
  }
  return fechar(o, custo, precoLinhas);
}

function fechar(o: Orcamento, custo: number, precoLinhas: number): Totais {
  const quantidade = Math.max(1, o.quantidade);
  const mesas = mesasDoPedido(o);
  const precoUnit = subir2(precoLinhas / quantidade);
  const precoFinal = arredondar2(precoUnit * quantidade);
  const brutoMesa = mesas > 0 ? subir2((precoLinhas - custo) / mesas) : 0;
  const lucroBruto = arredondar2(brutoMesa * mesas);
  const lucroLiquido = arredondar2(brutoMesa * (1 - o.oferta / 100) * mesas);
  const horasMesa = horasDaMesa(o);
  const horasTotais = horasMesa * mesas;
  return {
    custo, precoLinhas, mesas, precoUnit, precoFinal, lucroBruto, lucroLiquido,
    markupPct: custo > 0 ? (lucroBruto / custo) * 100 : 0, margemPct: precoFinal > 0 ? (lucroBruto / precoFinal) * 100 : 0,
    horasTotais, dias: horasTotais / Math.max(1, o.horasPorDia), valorHora: horasMesa > 0 ? precoLinhas / mesas / horasMesa : 0,
  };
}

// ---------- faixas de preço da matriz ----------

export const FAIXAS: { nome: string; fator: number }[] = [
  { nome: "Variável", fator: 1.8 }, { nome: "Mínimo escala", fator: 2.5 }, { nome: "Mínimo", fator: 3 }, { nome: "Médio escala", fator: 3.5 }, { nome: "Médio", fator: 4 },
  { nome: "Máximo escala", fator: 5 }, { nome: "Máximo", fator: 6 }, { nome: "Máximo hyper", fator: 8 }, { nome: "Máximo ultra hyper", fator: 10 },
];

export interface LinhaFaixa {
  nome: string;
  fator: number;
  /** lucro (markup) que a faixa representa, % */
  lucroPct: number;
  /** preço de uma unidade (coluna "CUST UNI") */
  precoUnit: number;
  lucroBruto: number;
  lucroLiquido: number;
  /** coluna "PORCENT. LUCRO" da matriz: lucro líquido ÷ preço da faixa Variável (referência fixa da planilha) */
  pctMatriz: number;
  /** "VR TOT PEDIDO" e "LUCRO TOTAL" */
  valorPedido: number;
  lucroTotal: number;
  /** "VALOR HORA" */
  valorHora: number;
}

/** A tabela de faixas da matriz para o custo atual do orçamento (cada faixa = fator × custo bruto). */
export function tabelaFaixas(o: Orcamento): LinhaFaixa[] {
  const custo = o.linhas.reduce((s, l) => s + contaDaLinha(l).custo, 0);
  const quantidade = Math.max(1, o.quantidade), mesas = mesasDoPedido(o);
  const horasMesa = horasDaMesa(o);
  const precoVariavel = custo * FAIXAS[0].fator;
  return FAIXAS.map((f) => {
    const precoTotal = custo * f.fator;
    const precoUnit = subir2(precoTotal / quantidade);
    const bruto = mesas > 0 ? subir2((precoTotal - custo) / mesas) : 0;
    const liquido = bruto * (1 - o.oferta / 100);
    return {
      nome: f.nome, fator: f.fator, lucroPct: (f.fator - 1) * 100, precoUnit, lucroBruto: bruto * mesas, lucroLiquido: liquido * mesas,
      pctMatriz: precoVariavel > 0 ? (liquido * mesas) / precoVariavel : 0, valorPedido: arredondar2(precoUnit * quantidade), lucroTotal: liquido * mesas,
      valorHora: horasMesa > 0 ? precoTotal / mesas / horasMesa : 0,
    };
  });
}

/** Conversor de horas da matriz: dias × 24 + horas. */
export const converterHoras = (dias: number, horas: number) => naoNegativo(dias) * 24 + naoNegativo(horas);

/** Rateia um valor entre itens pelos pesos, em centavos (a soma fecha exatamente; a sobra vai para o maior peso). */
export function ratear(total: number, pesos: number[]): number[] {
  const n = pesos.length;
  if (!n) return [];
  const soma = pesos.reduce((s, p) => s + Math.max(0, p), 0);
  const centavos = Math.round(total * 100);
  const base = pesos.map((p) => Math.floor((soma > 0 ? Math.max(0, p) / soma : 1 / n) * centavos));
  let sobra = centavos - base.reduce((s, x) => s + x, 0);
  const ordem = pesos.map((p, i) => i).sort((a, b) => pesos[b] - pesos[a] || a - b);
  for (let k = 0; sobra > 0; k = (k + 1) % n, sobra--) base[ordem[k]]++;
  return base.map((c) => c / 100);
}
