// Testes do orçamento do WJSlicer3D (src/slicer/orcamento.ts): as contas da MATRIZ_V01 em 3 casos (valores de
// referência obtidos recalculando a planilha original no LibreOffice com as mesmas entradas), a biblioteca de custos
// (incluir, editar, duplicar, desativar, buscar, WJERP), linhas da impressão, valores gravados no orçamento e rateio.
import {
  adicionarItem, bibliotecaPadrao, buscarItens, calcular, contaDaLinha, definirAtivo, duplicarItem, editarItem, empacotarBiblioteca, FAIXAS, horasDaMesa, importarDoErp,
  incluirItem, lerBiblioteca, linhaDoItem, lucroEmTodas, mudarLinha, normalizarOrcamento, orcamentoVazio, ratear, removerLinha, sincronizarImpressao, tabelaFaixas,
  trocarItemDaLinha, validarItem, converterHoras, ID_ENERGIA, type Biblioteca, type Orcamento,
} from "../src/slicer/orcamento";
import { montarProposta, proposta0, rotuloDoItem, totalDaProposta, formatarReais } from "../src/slicer/proposta";
import { crc32, deDataUrl, gerarDocx, lerZip, tamanhoDaImagem, zipar, PAGINA_A4, type Bloco } from "../src/documento/docx";
import { writeFileSync } from "node:fs";

let falhas = 0;
const ok = (c: boolean, m: string) => {
  console.log(`${c ? "✓" : "✗"} ${m}`);
  if (!c) falhas++;
};
const igual = (a: number, b: number, tol = 0.0051) => Math.abs(a - b) <= tol;

type Caso = { nome: string; filamento: string; massaG: number; horas: number; qtd: number; unid: number; E4: number; mesas: number; dias: number; faixas: [string, number, number, number, number, number, number, number][] };
const CASOS: Caso[] = [{"nome": "c1", "filamento": "PLA NACIO", "massaG": 650, "horas": 26, "qtd": 1, "unid": 1, "E4": 103.5008, "mesas": 1, "dias": 1.3, "faixas": [["VARIAVEL", 186.31, 82.81, 57.967, 0.311146279921401, 186.31, 57.967, 7.16544], ["MÍNIMO ESCALA", 258.76, 155.26, 108.682, 0.583366398026768, 258.76, 108.682, 9.952], ["MÍNIMO", 310.51, 207.01, 144.907, 0.777809339530601, 310.51, 144.907, 11.9424], ["MÉDIO ESCALA", 362.26, 258.76, 181.132, 0.972252281034435, 362.26, 181.132, 13.9328], ["MÉDIO", 414.01, 310.51, 217.357, 1.16669522253827, 414.01, 217.357, 15.9232], ["MÁXIMO ESCALA", 517.51, 414.01, 289.807, 1.55558110554594, 517.51, 289.807, 19.904], ["MÁXIMO", 621.01, 517.51, 362.257, 1.9444669885536, 621.01, 362.257, 23.8848], ["MÁXIMO HYPER", 828.01, 724.51, 507.157, 2.72223875456894, 828.01, 507.157, 31.8464], ["MÁXIMO ULTRA HYPER", 1035.01, 931.51, 652.057, 3.50001052058427, 1035.01, 652.057, 39.808]]}, {"nome": "c2", "filamento": "PLA NACIO", "massaG": 120, "horas": 5.5, "qtd": 12, "unid": 4, "E4": 20.3194, "mesas": 3, "dias": 0.825, "faixas": [["VARIAVEL", 9.15, 16.26, 11.382, 0.311196852925447, 109.8, 34.146, 6.64998545454546], ["MÍNIMO ESCALA", 12.7, 30.48, 21.336, 0.583350558251392, 152.4, 64.008, 9.23609090909091], ["MÍNIMO", 15.24, 40.64, 28.448, 0.777800744335189, 182.88, 85.344, 11.0833090909091], ["MÉDIO ESCALA", 17.78, 50.8, 35.56, 0.972250930418987, 213.36, 106.68, 12.9305272727273], ["MÉDIO", 20.32, 60.96, 42.672, 1.16670111650278, 243.84, 128.016, 14.7777454545455], ["MÁXIMO ESCALA", 25.4, 81.28, 56.896, 1.55560148867038, 304.8, 170.688, 18.4721818181818], ["MÁXIMO", 30.48, 101.6, 71.12, 1.94450186083797, 365.76, 213.36, 22.1666181818182], ["MÁXIMO HYPER", 40.64, 142.24, 99.568, 2.72230260517316, 487.68, 298.704, 29.5554909090909], ["MÁXIMO ULTRA HYPER", 50.8, 182.88, 128.016, 3.50010334950835, 609.6, 384.048, 36.9443636363636]]}, {"nome": "c3", "filamento": "PLA IMPORT", "massaG": 1830, "horas": 61.75, "qtd": 7, "unid": 3, "E4": 361.2469, "mesas": 2.33333333333333, "dias": 7.20416666666667, "faixas": [["VARIAVEL", 216.75, 289, 202.3, 0.311113780876428, 1517.25, 472.033333333333, 10.5302740080972], ["MÍNIMO ESCALA", 301.04, 541.88, 379.316, 0.583343721734667, 2107.28, 885.070666666667, 14.6253805668016], ["MÍNIMO", 361.25, 722.5, 505.75, 0.77778445219107, 2528.75, 1180.08333333333, 17.5504566801619], ["MÉDIO ESCALA", 421.46, 903.12, 632.184, 0.972225182647473, 2950.22, 1475.096, 20.4755327935223], ["MÉDIO", 481.67, 1083.75, 758.625, 1.16667667828661, 3371.69, 1770.125, 23.4006089068826], ["MÁXIMO ESCALA", 602.08, 1444.99, 1011.493, 1.55555813919941, 4214.56, 2360.15033333333, 29.2507611336032], ["MÁXIMO", 722.5, 1806.24, 1264.368, 1.94445036529495, 5057.5, 2950.192, 35.1009133603239], ["MÁXIMO HYPER", 963.33, 2528.73, 1770.111, 2.72222405230329, 6743.31, 4130.259, 46.8012178137652], ["MÁXIMO ULTRA HYPER", 1204.16, 3251.23, 2275.861, 3.50000850449436, 8429.12, 5310.34233333333, 58.5015222672065]]}];

// ---------- as contas da matriz ----------
for (const c of CASOS) {
  let bib = bibliotecaPadrao();
  const importado = c.filamento === "PLA IMPORT";
  let o: Orcamento = { ...orcamentoVazio(), quantidade: c.qtd, unidadesPorMesa: c.unid };
  o = sincronizarImpressao(o, { cores: [{ indice: 0, nome: "Cor 1", material: "pla", massaG: c.massaG }], horasMesa: c.horas }, bib);
  if (importado) o = trocarItemDaLinha(o, o.linhas.find((l) => l.chave === "fil:0")!.id, bib.itens.find((i) => i.id === "fil-pla-importado")!);
  ok(o.linhas.length === 3, `${c.nome}: três linhas da impressão (filamento, energia, desgaste)`);
  const mesas = c.qtd / c.unid;
  const custoMesa = calcular(o).custo / mesas;
  ok(igual(custoMesa, c.E4, 1e-9), `${c.nome}: custo bruto da mesa ${custoMesa.toFixed(4)} = planilha ${c.E4}`);
  ok(igual(horasDaMesa(o), c.horas, 1e-9) && igual(calcular(o).mesas, c.mesas, 1e-9), `${c.nome}: horas da mesa e número de mesas`);
  ok(igual(calcular(o).dias, c.dias, 1e-9), `${c.nome}: dias de produção ${calcular(o).dias.toFixed(4)} = ${c.dias}`);
  // faixa "Variável" = lucro de 80 % em todas as linhas (padrão do orçamento) → totais do orçamento
  const t = calcular(o);
  const [, G, H, I, , K, L, M] = c.faixas[0];
  ok(igual(t.precoUnit, G), `${c.nome}: preço unitário R$ ${t.precoUnit} = ${G}`);
  ok(igual(t.precoFinal, K), `${c.nome}: valor total do pedido R$ ${t.precoFinal} = ${K}`);
  ok(igual(t.lucroBruto / mesas, H), `${c.nome}: lucro bruto por mesa ${(t.lucroBruto / mesas).toFixed(2)} = ${H}`);
  ok(igual(t.lucroLiquido, L, 0.01), `${c.nome}: lucro total (líquido de 30 %) ${t.lucroLiquido} = ${L.toFixed(4)}`);
  ok(igual(t.lucroLiquido / mesas, I, 0.01), `${c.nome}: lucro líquido por mesa = ${I}`);
  ok(igual(t.valorHora, M, 0.0001), `${c.nome}: valor da hora ${t.valorHora.toFixed(4)} = ${M.toFixed(4)}`);
  // todas as faixas da matriz (coluna a coluna)
  const tab = tabelaFaixas(o);
  ok(tab.length === c.faixas.length && tab.every((f, i) => f.fator === FAIXAS[i].fator), `${c.nome}: nove faixas, fatores 1,8 … 10`);
  let tudo = true;
  c.faixas.forEach(([, g, h, i, j, k, l, m], n) => {
    const f = tab[n];
    const bom = igual(f.precoUnit, g) && igual(f.lucroBruto / mesas, h) && igual(f.lucroLiquido / mesas, i, 0.01) && igual(f.pctMatriz, j, 1e-5) && igual(f.valorPedido, k) && igual(f.lucroTotal, l, 0.01) && igual(f.valorHora, m, 0.0001);
    if (!bom) {
      tudo = false;
      console.log("   faixa", n, f, { g, h, i, j, k, l, m });
    }
  });
  ok(tudo, `${c.nome}: faixas — preço, lucro bruto e líquido, %, valor do pedido, lucro total e valor/hora iguais aos da planilha`);
  // aplicar a faixa mais alta nas linhas = mesmo valor da planilha
  const alto = calcular(lucroEmTodas(o, (FAIXAS[8].fator - 1) * 100));
  ok(igual(alto.precoFinal, c.faixas[8][5]), `${c.nome}: "Máximo ultra hyper" aplicada nas linhas: R$ ${alto.precoFinal} = ${c.faixas[8][5]}`);
}

// ---------- lucro por linha, totais e margens ----------
{
  const bib = bibliotecaPadrao();
  let o = sincronizarImpressao(orcamentoVazio(), { cores: [{ indice: 0, nome: "Preto", material: "pla", massaG: 100 }], horasMesa: 4 }, bib);
  const ima = bib.itens.find((i) => i.id === "mat-ima-10x4")!;
  o = adicionarItem(o, ima, 4);
  const l = o.linhas.find((x) => x.rotulo === "Ímã 10×4")!;
  ok(l.quantidade === 4 && l.custoUnit === 5 && l.lucro === 30, "Ímã 10×4: quantidade 4, R$ 5/un e lucro padrão de 30 % copiados do item");
  const c = contaDaLinha(l);
  ok(c.custo === 20 && igual(c.preco, 26, 1e-9) && igual(c.lucro, 6, 1e-9), "linha do ímã: custo 4 × 5 = 20, preço 26, lucro 6");
  const antes = calcular(o);
  o = mudarLinha(o, l.id, { lucro: 100 });
  const depois = calcular(o);
  ok(igual(depois.precoLinhas - antes.precoLinhas, 14, 1e-9), "mudar o lucro da linha para 100 % soma R$ 14 ao preço");
  ok(igual(depois.markupPct, (depois.lucroBruto / depois.custo) * 100, 1e-9) && depois.margemPct < depois.markupPct, "markup (sobre o custo) maior que a margem (sobre o preço)");
  ok(igual(depois.custo, 0.1 * 90 + 4 * 0.7308 + 4 * 1 + 20, 1e-9), "custo total = filamento + energia + desgaste + ímãs");
  const sem = removerLinha(o, l.id);
  ok(sem.linhas.length === 3 && sem.removidas.length === 0, "tirar linha da biblioteca não deixa marca de removida");
  const semDesgaste = removerLinha(o, o.linhas.find((x) => x.chave === "maq:desgaste")!.id);
  const volta = sincronizarImpressao(semDesgaste, { cores: [{ indice: 0, nome: "Preto", material: "pla", massaG: 120 }], horasMesa: 5 }, bib);
  ok(!volta.linhas.some((x) => x.chave === "maq:desgaste") && volta.linhas.find((x) => x.chave === "fil:0")!.quantidade === 0.12, "linha da impressão tirada não volta sozinha; as outras têm a quantidade atualizada");
  const restaurada = sincronizarImpressao(volta, { cores: [{ indice: 0, nome: "Preto", material: "pla", massaG: 120 }], horasMesa: 5 }, bib, true);
  ok(restaurada.linhas.some((x) => x.chave === "maq:desgaste" && x.quantidade === 5), "\"Atualizar da impressão\" traz de volta a linha tirada");
  // lucro editado numa linha da impressão sobrevive à nova fatiada
  const edit = mudarLinha(o, o.linhas[0].id, { lucro: 55 });
  const re = sincronizarImpressao(edit, { cores: [{ indice: 0, nome: "Preto", material: "pla", massaG: 300 }], horasMesa: 9 }, bib);
  ok(re.linhas[0].lucro === 55 && igual(re.linhas[0].quantidade, 0.3, 1e-9), "lucro editado na linha do filamento fica; só a quantidade acompanha o fatiador");
  // cor que deixou de ser usada sai
  const duas = sincronizarImpressao(orcamentoVazio(), { cores: [{ indice: 0, nome: "A", material: "pla", massaG: 10 }, { indice: 2, nome: "C", material: "petg", massaG: 5 }], horasMesa: 1 }, bib);
  ok(duas.linhas.filter((x) => x.chave?.startsWith("fil:")).length === 2 && duas.linhas.find((x) => x.chave === "fil:2")!.rotulo.includes("PETG"), "uma linha de filamento por cor usada, com o filamento do material (PETG)");
  const uma = sincronizarImpressao(duas, { cores: [{ indice: 0, nome: "A", material: "pla", massaG: 10 }], horasMesa: 1 }, bib);
  ok(!uma.linhas.some((x) => x.chave === "fil:2"), "cor que saiu da peça perde a linha");
  ok(uma.linhas.map((x) => x.origem).join() === "impressao,impressao,impressao", "linhas da impressão ficam antes das da biblioteca");
}

// ---------- valores gravados: a biblioteca muda e o orçamento antigo não ----------
{
  let bib = bibliotecaPadrao();
  let o = adicionarItem(orcamentoVazio(), bib.itens.find((i) => i.id === "mat-chumbo")!, 2);
  const antes = calcular(o).precoFinal;
  bib = editarItem(bib, "mat-chumbo", { custo: 999, lucro: 50 });
  bib = definirAtivo(bib, "mat-chumbo", false);
  ok(calcular(o).precoFinal === antes && antes === 120, "mudar/desativar o item na biblioteca não muda o orçamento já feito (chumbo 2 kg × R$ 60)");
  const salvo = normalizarOrcamento(JSON.parse(JSON.stringify(o)));
  ok(calcular(salvo).precoFinal === 120 && salvo.linhas[0].custoUnit === 60, "orçamento salvo e lido guarda os valores");
  ok(normalizarOrcamento(null).linhas.length === 0 && normalizarOrcamento({ quantidade: -3, unidadesPorMesa: 0, oferta: 500 } as Partial<Orcamento>).quantidade === 1, "orçamento inválido volta ao padrão");
}

// ---------- biblioteca de custos ----------
{
  let b: Biblioteca = bibliotecaPadrao();
  const ex = (id: string) => b.itens.find((i) => i.id === id)!;
  ok(ex("mat-chumbo").custo === 60 && ex("mat-chumbo").unidade === "kg" && ex("mat-chumbo").lucro === 0, "exemplo: Chumbo 60 R$/kg 0 %");
  ok(ex("mo-modelagem").custo === 30 && ex("mo-modelagem").unidade === "h" && ex("mo-modelagem").categoria === "mao-de-obra", "exemplo: H-H Modelagem 30 R$/h 0 %");
  ok(ex("mat-ima-10x4").custo === 5 && ex("mat-ima-10x4").lucro === 30 && ex("mat-ima-10x4").unidade === "un", "exemplo: Ímã 10×4 R$ 5/un 30 %");
  ok(ex("fil-pla-nacional").custo === 90 && ex("fil-pla-importado").custo === 139 && ex("fil-abs").custo === 75 && ex("fil-tpu").custo === 135 && ex("fil-petg").custo === 100 && ex("fil-resina").custo === 149, "filamentos de fábrica com o preço médio da planilha");
  ok(igual(ex(ID_ENERGIA).custo, 0.63 * 1.16, 1e-9), "energia da máquina = 630 W × R$ 1,16/kWh = R$ 0,7308/h");
  // incluir
  b = incluirItem(b, { nome: "  Parafuso M3  ", categoria: "material", unidade: "un", custo: 0.4, lucro: 100 });
  const par = b.itens.find((i) => i.nome === "Parafuso M3")!;
  ok(!!par && par.ativo && par.custo === 0.4, "incluir item (nome aparado, ativo)");
  ok(validarItem({ nome: "", unidade: "un", custo: 1, lucro: 0 }) !== null && validarItem({ nome: "x", unidade: "", custo: 1, lucro: 0 }) !== null && validarItem({ nome: "x", unidade: "un", custo: -1, lucro: 0 }) !== null && validarItem({ nome: "x", unidade: "un", custo: 1, lucro: 0 }) === null, "validação: nome, unidade e custo");
  // editar
  b = editarItem(b, par.id, { custo: 0.5 });
  ok(b.itens.find((i) => i.id === par.id)!.custo === 0.5 && b.itens.length === 12, "editar muda só o item");
  // duplicar
  const d1 = duplicarItem(b, par.id);
  b = d1.biblioteca;
  ok(d1.novo!.nome === "Parafuso M3 (cópia)" && d1.novo!.id !== par.id && d1.novo!.custo === 0.5, "duplicar: cópia com outro id e nome");
  const d2 = duplicarItem(b, par.id);
  ok(d2.novo!.nome === "Parafuso M3 (cópia 2)", "duplicar de novo: (cópia 2)");
  b = d2.biblioteca;
  // desativar
  b = definirAtivo(b, par.id, false);
  ok(!buscarItens(b, "parafuso").some((i) => i.id === par.id) && buscarItens(b, "parafuso", { inativos: true }).some((i) => i.id === par.id), "desativado some da busca (aparece com 'inativos')");
  b = definirAtivo(b, par.id, true);
  // buscar
  ok(buscarItens(b, "imã").length === 1 && buscarItens(b, "IMA 10").length === 1, "busca sem acento e sem maiúsculas (ímã)");
  ok(buscarItens(b, "", { categoria: "filamento" }).length === 6 && buscarItens(b, "mão de obra").some((i) => i.id === "mo-modelagem"), "filtro por categoria e busca pelo nome da categoria");
  ok(buscarItens(b, "kg").every((i) => i.unidade === "kg"), "busca pela unidade");
  // arquivo: ida e volta
  const lido = lerBiblioteca(empacotarBiblioteca(b));
  ok(lido.itens.length === b.itens.length && lido.itens.every((i, n) => i.id === b.itens[n].id && i.custo === b.itens[n].custo), "arquivo da biblioteca: salvar e ler");
  let erro = false;
  try {
    lerBiblioteca("{\"formato\":\"outro\"}");
  } catch {
    erro = true;
  }
  ok(erro, "arquivo que não é da biblioteca é recusado");
  const sujo = lerBiblioteca(JSON.stringify({ formato: "wjcus", itens: [{ id: "a", nome: "ok", custo: -5, lucro: "x" }, { id: "a", nome: "repetido" }, { nome: "sem id" }, null] }));
  ok(sujo.itens.length === 1 && sujo.itens[0].custo === 0 && sujo.itens[0].lucro === 0 && sujo.itens[0].unidade === "un", "itens inválidos descartados, números ruins viram 0");
  // WJERP
  const e1 = importarDoErp(b, [
    { codigo: "PAR-001", descricao: "Parafuso M4", unidade: "un", custoPadrao: 0.8 },
    { codigo: "CAB-002", descricao: "Cabo", unidade: "m", preco: 3 },
    { codigo: "", descricao: "sem código", unidade: "un", preco: 1 },
    { codigo: "ZER-1", descricao: "sem custo", unidade: "un" },
  ]);
  ok(e1.novos === 2 && e1.atualizados === 0 && e1.biblioteca.itens.find((i) => i.codigo === "PAR-001")!.categoria === "material", "WJERP: itens com código e custo entram (sem código ou sem custo, não)");
  b = editarItem(e1.biblioteca, e1.biblioteca.itens.find((i) => i.codigo === "PAR-001")!.id, { lucro: 40 });
  const e2 = importarDoErp(b, [{ codigo: "PAR-001", descricao: "Parafuso M4", unidade: "un", custoPadrao: 0.9 }, { codigo: "CAB-002", descricao: "Cabo", unidade: "m", preco: 3 }]);
  const par4 = e2.biblioteca.itens.find((i) => i.codigo === "PAR-001")!;
  ok(e2.novos === 0 && e2.atualizados === 1 && par4.custo === 0.9 && par4.lucro === 40, "WJERP de novo: atualiza o custo pelo código e mantém o lucro");
  ok(duplicarItem(e2.biblioteca, par4.id).novo!.codigo === undefined, "a cópia de um item do WJERP não herda o código");
}

// ---------- horas e rateio ----------
ok(converterHoras(2, 15) === 63, "conversor de horas da matriz: 2 dias + 15 h = 63 h");
{
  const r = ratear(257.3, [1, 1, 1]);
  ok(r.length === 3 && Math.abs(r.reduce((s, x) => s + x, 0) - 257.3) < 1e-9 && r.every((x) => Math.abs(x - 85.77) < 0.011), "ratear R$ 257,30 em 3 partes iguais fecha em centavos");
  const p = ratear(100, [3, 1]);
  ok(p[0] === 75 && p[1] === 25, "ratear proporcional aos pesos (75 / 25)");
  ok(ratear(10, [0, 0]).reduce((s, x) => s + x, 0) === 10 && ratear(5, []).length === 0, "pesos zerados dividem igual; lista vazia");
}
ok(linhaDoItem(bibliotecaPadrao().itens[0], 2).quantidade === 2, "linha do item");


// ---------- proposta comercial (modelo do .docx do Johann) ----------
const PNG1 = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
{
  const d = proposta0(new Date(2026, 10, 10));
  d.emissor = "Johann L. Sicherl";
  d.cliente = { nome: "GRAFIX EXPRESS", endereco: "Av. Pref. João Daher, 954", bairro: "Vila Pinto Coelho", cidade: "Lagoa Santa", telefone: "+55 31 98880-3274" };
  d.produto = { descritivo: "Impressão de dispositivos <para> otimização", dimensoes: "N/A", cores: "Amarelo, Preto e Rosa", material: "Próprio para ambientes internos.", obs: "Inclui visita técnica." };
  d.prazo = "4 dias úteis";
  d.itens = [
    { nome: "Conjunto Suporte Rolo de Plastificação com Imãs e Clipes", quantidade: 1, preco: 80, imagens: [PNG1] },
    { nome: "Suporte para HeadPhone (Mesa 50mm) Rosa e Preto", quantidade: 1, preco: 20, imagens: [PNG1, "javascript:alert(1)"] },
    { nome: "Suporte para HeadPhone (Mesa 50mm) Preto e amarelo", quantidade: 2, preco: 20, imagens: [PNG1] },
    { nome: "Conjunto Direcionador de Papel Máquina de Corte", quantidade: 1, preco: 117.3, imagens: [PNG1] },
  ];
  ok(totalDaProposta(d) === 257.3, "proposta: valor total do modelo do Johann = R$ 257,30 (80 + 20 + 2 × 20 + 117,30)");
  ok(formatarReais(257.3) === "R$ 257,30" || formatarReais(257.3).replace(/\s/g, " ") === "R$ 257,30", "reais em pt-BR");
  ok(rotuloDoItem(d.itens[2]).titulo === "2 x Suporte para HeadPhone (Mesa 50mm) Preto e amarelo" && rotuloDoItem(d.itens[2]).valor.replace(/\s/g, " ") === "(R$ 20,00 – Cada)" && rotuloDoItem(d.itens[0]).valor.replace(/\s/g, " ") === "(R$ 80,00)", "rótulo do item: \"2 x nome\" e \"(R$ 20,00 – Cada)\"");
  const m = montarProposta(d);
  ok(m.formato === "wjdoc" && m.nome === "Proposta comercial - GRAFIX EXPRESS" && m.pagina.tamanho === "A4", "documento .wjdoc em A4 com nome da proposta");
  const ordem = ["PROPOSTA COMERCIAL", "Johann L. Sicherl – 10/11/2026", "Dados do Cliente", "GRAFIX EXPRESS", "Informações do Produto / Serviço", "Custo de Investimento", "Valor Total:</b> R$", "Entrega do Pedido", "4 dias úteis", "Imagens do Pedido", "1 x Conjunto Suporte Rolo"].map((t) => m.html.indexOf(t));
  ok(ordem.every((x, i) => x >= 0 && (i === 0 || x > ordem[i - 1])), "seções na ordem do modelo (título, emissor, cliente, produto, investimento, entrega, imagens)");
  ok(m.html.includes("Descritivo do Produto / Serviço:</b> Impressão de dispositivos &lt;para&gt; otimização") && !m.html.includes("<para>"), "texto digitado é escapado (sem HTML solto)");
  ok((m.html.match(/<img /g) ?? []).length === 4 && !m.html.includes("javascript:"), "imagens: só data URL de imagem entra (4 de 5)");
  ok(m.html.includes('<hr class="dc-pagina">') && m.html.indexOf('<hr class="dc-pagina">') < m.html.indexOf("Imagens do Pedido"), "imagens do pedido começam em página nova");
  ok(!montarProposta({ ...d, cliente: { ...d.cliente, nome: "" } }).html.includes("Nome / Empresa"), "campo em branco não aparece");
  ok(montarProposta({ ...d, logo: PNG1 }).html.includes("Logotipo do emissor") && !montarProposta(d).html.includes("Logotipo"), "logotipo do emissor opcional");

  // ---------- .docx ----------
  ok(crc32(new TextEncoder().encode("123456789")) === 0xcbf43926, "CRC-32 de \"123456789\" = CBF43926");
  const z = zipar([{ nome: "a.txt", dados: new TextEncoder().encode("olá") }, { nome: "pasta/b.bin", dados: Uint8Array.from([0, 1, 2, 255]) }]);
  const lz = lerZip(z);
  ok(lz.length === 2 && lz[0].nome === "a.txt" && new TextDecoder().decode(lz[0].dados) === "olá" && lz[1].dados.join() === "0,1,2,255", "zip: gravar e ler (nomes, conteúdo e CRC)");
  const img = deDataUrl(PNG1)!;
  const tp = tamanhoDaImagem(img.dados)!;
  ok(tp.ext === "png" && tp.largura === 1 && tp.altura === 1, "tamanho de um PNG pelo cabeçalho");
  const jpg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xc0, 0, 0x11, 8, 0, 0x10, 0, 0x20, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1, 0xff, 0xd9]);
  const tj = tamanhoDaImagem(jpg)!;
  ok(tj.ext === "jpeg" && tj.largura === 32 && tj.altura === 16, "tamanho de um JPEG pelo cabeçalho (32 × 16)");
  const blocos: Bloco[] = [
    { tipo: "p", corridas: [{ texto: "PROPOSTA & <COMERCIAL>" }], estilo: "h1", alinhamento: "center" },
    { tipo: "p", corridas: [{ texto: "Valor: ", negrito: true }, { texto: "R$ 257,30", italico: true, sublinhado: true, cor: "ff0000", tamanho: 12 }, { texto: "linha 2", quebra: true }] },
    { tipo: "tabela", linhas: [{ cabecalho: true, celulas: [[{ tipo: "p", corridas: [{ texto: "Item" }] }], [{ tipo: "p", corridas: [{ texto: "Preço" }] }]] }, { celulas: [[{ tipo: "p", corridas: [{ texto: "Suporte" }] }], [{ tipo: "p", corridas: [{ texto: "R$ 20,00" }] }]] }] },
    { tipo: "pagina" },
    { tipo: "img", dados: img.dados, ext: "png", larguraMm: 50, alturaMm: 50, alinhamento: "center", alt: "foto" },
  ];
  const dx = gerarDocx(blocos, PAGINA_A4, "Proposta");
  const partes = lerZip(dx);
  const nomes = partes.map((x) => x.nome);
  ok(["[Content_Types].xml", "_rels/.rels", "word/document.xml", "word/_rels/document.xml.rels", "word/styles.xml", "word/media/image1.png"].every((n) => nomes.includes(n)), ".docx: partes obrigatórias e a imagem");
  const xml = new TextDecoder().decode(partes.find((x) => x.nome === "word/document.xml")!.dados);
  ok(xml.includes("PROPOSTA &amp; &lt;COMERCIAL&gt;") && xml.includes('<w:pStyle w:val="Heading1"/>') && xml.includes('<w:jc w:val="center"/>') && xml.includes('w:br w:type="page"') && xml.includes("<w:tbl>") && xml.includes("<w:tblHeader/>") && xml.includes('r:embed="rIdImg1"'), ".docx: texto escapado, título, centralizado, quebra de página, tabela com cabeçalho e imagem");
  ok(xml.includes('<w:pgSz w:w="11906" w:h="16838"/>') && xml.includes('w:left="1701"'), ".docx: A4 e margem de 30 mm");
  if (process.env.WJ_DOCX) writeFileSync(process.env.WJ_DOCX, dx);
  if (process.env.WJ_DOCX) writeFileSync(process.env.WJ_DOCX.replace(/\.docx$/, ".wjdoc"), JSON.stringify(m));
}

console.log(falhas ? `\n${falhas} falha(s)` : "\nOrçamento: tudo certo");
process.exit(falhas ? 1 : 0);
