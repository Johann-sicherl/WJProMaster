// WJSlicer3D → WJWrite: proposta comercial a partir do orçamento. Segue o modelo da proposta do Johann (cabeçalho com
// "PROPOSTA COMERCIAL", emissor e data; Dados do Cliente; Informações do Produto / Serviço; Custo de Investimento;
// Entrega do Pedido; Imagens do Pedido com "N x item (R$ valor)" e as imagens de cada item). Puro: devolve o documento
// .wjdoc (HTML da folha) que o WJWrite abre; testado em scripts/teste-orcamento.ts.

export interface ItemProposta {
  nome: string;
  quantidade: number;
  /** preço de uma unidade, R$ */
  preco: number;
  /** imagens (data URL JPEG/PNG): vista isométrica automática e vistas escolhidas no WJCAD */
  imagens: string[];
}

export interface DadosProposta {
  emissor: string;
  /** dd/mm/aaaa */
  data: string;
  cliente: { nome: string; endereco: string; bairro: string; cidade: string; telefone: string };
  produto: { descritivo: string; dimensoes: string; cores: string; material: string; obs: string };
  pagamento: string;
  prazo: string;
  local: string;
  itens: ItemProposta[];
  /** logotipo/QR do emissor (data URL), opcional: fica no alto da proposta */
  logo?: string;
}

export const proposta0 = (hoje = new Date()): DadosProposta => ({
  emissor: "", data: hoje.toLocaleDateString("pt-BR"),
  cliente: { nome: "", endereco: "", bairro: "", cidade: "", telefone: "" },
  produto: { descritivo: "", dimensoes: "N/A", cores: "", material: "", obs: "" },
  pagamento: "50% de adiantamento para início da manufatura, e o restante no ato da entrega",
  prazo: "", local: "No endereço informado no cabeçalho.", itens: [],
});

const escapar = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const reais = (v: number) => `R$ ${v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const formatarReais = reais;

/** Valor total da proposta: soma de quantidade × preço de cada item (em centavos, sem ruído). */
export const totalDaProposta = (d: Pick<DadosProposta, "itens">) => Math.round(d.itens.reduce((s, i) => s + Math.round(i.preco * 100) * Math.max(0, i.quantidade), 0)) / 100;

const campo = (rotulo: string, valor: string) => (valor.trim() ? `<p><b>${escapar(rotulo)}:</b> ${escapar(valor.trim())}</p>` : "");
const imagemSegura = (u: string) => (/^data:image\/(png|jpeg|jpg);base64,[A-Za-z0-9+/=]+$/.test(u) ? u : "");

/** Linha da lista de imagens: "2 x Suporte" + "(R$ 20,00 – Cada)" ou "(R$ 80,00)". */
export function rotuloDoItem(i: ItemProposta): { titulo: string; valor: string } {
  return { titulo: `${i.quantidade} x ${i.nome}`, valor: i.quantidade > 1 ? `(${reais(i.preco)} – Cada)` : `(${reais(i.preco)})` };
}

export function montarProposta(d: DadosProposta): { formato: "wjdoc"; versao: 1; nome: string; html: string; pagina: { tamanho: "A4"; orientacao: "retrato"; margens: { sup: number; inf: number; esq: number; dir: number }; cabecalho: string; rodape: string; numerar: boolean } } {
  const total = totalDaProposta(d);
  const logo = d.logo && imagemSegura(d.logo) ? `<p style="text-align:center"><img src="${d.logo}" alt="Logotipo do emissor" style="width:22%" data-alinhar="centro" /></p>` : "";
  const partes: string[] = [
    logo,
    `<h1 style="text-align:center">PROPOSTA COMERCIAL</h1>`,
    `<p style="text-align:center">${escapar([d.emissor.trim(), d.data.trim()].filter(Boolean).join(" – "))}</p>`,
    `<h2>Dados do Cliente</h2>`,
    campo("Nome / Empresa", d.cliente.nome), campo("Endereço", d.cliente.endereco), campo("Bairro", d.cliente.bairro), campo("Cidade", d.cliente.cidade), campo("Telefone", d.cliente.telefone),
    `<h2>Informações do Produto / Serviço</h2>`,
    campo("Descritivo do Produto / Serviço", d.produto.descritivo), campo("Dimensões", d.produto.dimensoes), campo("Cores", d.produto.cores), campo("Material", d.produto.material), campo("Obs", d.produto.obs),
    `<h2>Custo de Investimento</h2>`,
    campo("Valor por Produto / Serviço", "Vide imagens."), campo("Quantidade Solicitada / Necessária", "Vide imagens"), campo("Valor Total", reais(total)), campo("Forma de Pagamento", d.pagamento),
    `<h2>Entrega do Pedido</h2>`,
    campo("Prazo", d.prazo), campo("Local de Entrega", d.local),
    `<hr class="dc-pagina"><p><br></p>`,
    `<h2>Imagens do Pedido</h2>`,
  ];
  for (const i of d.itens) {
    const r = rotuloDoItem(i);
    partes.push(`<p><b>${escapar(r.titulo)}</b></p>`, `<p>${escapar(r.valor)}</p>`);
    for (const u of i.imagens) {
      const seguro = imagemSegura(u);
      if (seguro) partes.push(`<p style="text-align:center"><img src="${seguro}" alt="${escapar(i.nome)}" style="width:70%" data-alinhar="centro" /></p>`);
    }
  }
  const nomeBase = (d.cliente.nome.trim() || "Cliente").replace(/[\\/:*?"<>|]/g, "_");
  return {
    formato: "wjdoc", versao: 1, nome: `Proposta comercial - ${nomeBase}`, html: partes.filter(Boolean).join(""),
    pagina: { tamanho: "A4", orientacao: "retrato", margens: { sup: 25, inf: 20, esq: 30, dir: 20 }, cabecalho: "", rodape: d.emissor.trim() ? `Proposta comercial — ${d.emissor.trim()}` : "Proposta comercial", numerar: true },
  };
}
