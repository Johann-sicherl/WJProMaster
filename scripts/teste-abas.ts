// Testes da fatia L2 do WJSlicer3D (docs/global/wjslicer3d-layout.md §6): as abas Velocidade, Suporte e Outros do painel
// só mostram campos que mudam tempo ou massa. Critério: TODO campo visível dessas abas (✅/🟡) muda o resultado da fatia
// em pelo menos um cenário em que o campo está visível; campos sem efeito no orçamento (🔶/⚪/⛔) ficam ocultos e nunca
// aparecem na tela nem na busca; salvar e reabrir o perfil e o projeto devolve o mesmo tempo e a mesma massa.
import { fatiarPlaca, type MalhaImpressao } from "../src/slicer/fatiar";
import { maquinaPorId, materialDa } from "../src/slicer/perfis";
import { PERFIL_PADRAO, ajustesDe, planoBase, resolver, type PerfilUsuario } from "../src/slicer/camadas";
import { ESQUEMA, camposVisiveis, valorValido, visivelAgora, type Campo, type Plano, type Valor } from "../src/slicer/esquema";
import { definirValor, diferencasParaPerfil, gruposDoPainel, buscarCampos, valoresDoPlano } from "../src/slicer/painel";
import { filamentosPadrao, topologia } from "../src/slicer/cores";
import { novoPerfil, salvarPerfil, perfisVazios, empacotarPerfis, lerPerfis, perfisAtivos } from "../src/slicer/perfisUsuario";
import { empacotar, desempacotar, type ProjetoSlicer } from "../src/slicer/projeto";

let falhas = 0;
const ok = (cond: boolean, msg: string) => {
  console.log(`${cond ? "✓" : "✗"} ${msg}`);
  if (!cond) falhas++;
};

function caixas(lista: [number, number, number, number, number, number][]): MalhaImpressao {
  const pos: number[] = [], tri: number[] = [];
  for (const [x0, y0, z0, x1, y1, z1] of lista) {
    const b = pos.length / 3;
    for (const z of [z0, z1]) for (const y of [y0, y1]) for (const x of [x0, x1]) pos.push(x, y, z);
    for (const [a, bb, c, d] of [[0, 2, 3, 1], [4, 5, 7, 6], [0, 1, 5, 4], [2, 6, 7, 3], [0, 4, 6, 2], [1, 3, 7, 5]]) tri.push(b + a, b + bb, b + c, b + a, b + c, b + d);
  }
  return { pos: Float32Array.from(pos), tri: Uint32Array.from(tri) };
}

// ---------- cenários (peças pequenas e camada de 0,28 mm para o teste ser rápido) ----------
const CUBO = caixas([[0, 0, 0, 16, 16, 12]]);
/** coluna com um braço em balanço (suporte a partir da mesa) */
const T = caixas([[8, 0, 0, 16, 8, 14], [0, 0, 14, 24, 8, 17]]);
/** pilar sobre uma base larga e braço em balanço sobre a base: o suporte só alcança a peça, não a mesa */
const Z = caixas([[0, 0, 0, 30, 8, 4], [0, 0, 4, 8, 8, 16], [0, 0, 16, 30, 8, 19]]);
/** placa fina (vãos) e cubo pequeno (perímetro pequeno) */
const FINA = caixas([[0, 0, 0, 30, 0.9, 8], [0, 10, 0, 5, 15, 8]]);
/** bloco cuja face +X se inclina para fora ~42°: o balanço de cada camada é ~60 % do filete (faixa de 50 a 75 %) */
function inclinada(dx: number, H: number): MalhaImpressao {
  const m = caixas([[0, 0, 0, 10, 10, H]]);
  for (let i = 0; i < m.pos.length; i += 3) if (m.pos[i + 2] === H && m.pos[i] === 10) m.pos[i] += dx;
  return m;
}
const corT = (m: MalhaImpressao, f: (cx: number, cy: number, cz: number) => number) => {
  const top = topologia(m), n = m.tri.length / 3, r = new Uint8Array(n);
  for (let t = 0; t < n; t++) r[t] = f(top.centro[t * 3], top.centro[t * 3 + 1], top.centro[t * 3 + 2]);
  return r;
};

interface Cenario { nome: string; malha: MalhaImpressao; cores?: Uint8Array; plano: Plano }
const CENARIOS: Cenario[] = [
  { nome: "cubo", malha: CUBO, plano: {} },
  { nome: "balanço, suporte normal, borda e saia", malha: T, plano: { suporte: "normal", borda: true, saia: true } },
  { nome: "balanço, suporte em árvore, borda e saia", malha: T, plano: { suporte: "arvore", borda: true, saia: true } },
  { nome: "base larga, suporte normal", malha: Z, plano: { suporte: "normal" } },
  { nome: "base larga, suporte em árvore", malha: Z, plano: { suporte: "arvore" } },
  { nome: "placa fina e cubo pequeno", malha: FINA, plano: { preenchimentoVaos: true, limitePerimetroPequeno: 30 } },
  { nome: "parede inclinada", malha: inclinada(11, 12), plano: {} },
  { nome: "balanço pintado, suporte normal", malha: T, cores: corT(T, (_x, _y, z) => (z > 14 ? 1 : 0)), plano: { suporte: "normal" } },
];
const MAQS = ["bbl-p1s", "acu-k3"] as const;
const base: Plano = { altura: 0.28 };

const assinatura = (maq: string, c: Cenario, extra: Plano) => {
  const res = resolver({ maquina: maq, sistema: PERFIL_PADRAO, projeto: { ...base, ...c.plano, ...extra } });
  const m = { ...maquinaPorId(maq), processo: res.processo };
  const { r } = fatiarPlaca([{ nome: c.nome, malha: c.malha, posicoes: [[0, 0]], cores: c.cores }], m, materialDa(m, "pla"), ajustesDe(res), undefined, { filamentos: filamentosPadrao("pla", 120), troca: m.troca });
  return [r.tempoS, r.massaG, r.custo, r.trocas.total, ...r.cores.map((x) => x.massaG)].map((x) => +Number(x).toPrecision(9)).join("|");
};
const cacheBase = new Map<string, string>();
const assinaturaBase = (maq: string, c: Cenario) => {
  const k = `${maq}/${c.nome}`;
  if (!cacheBase.has(k)) cacheBase.set(k, assinatura(maq, c, {}));
  return cacheBase.get(k)!;
};

/** Valores para tentar no campo: a metade, o dobro, o outro item da lista ou o contrário. */
function tentativas(c: Campo, atual: Valor): Valor[] {
  const dentro = (n: number) => Math.min(c.max ?? n, Math.max(c.min ?? n, c.tipo === "inteiro" ? Math.round(n) : n));
  if (c.tipo === "booleano") return [!atual];
  if (c.tipo === "lista" || c.tipo === "padrao") return (c.opcoes ?? []).map(([o]) => o).filter((o) => o !== atual);
  if (typeof atual !== "number") return [];
  const cand = atual === 0 ? [dentro(10), dentro(1), dentro(c.max ?? 1)] : [dentro(atual * 0.5), dentro(atual * 2), dentro(atual + 1)];
  return cand.filter((v) => v !== atual && valorValido(c, v));
}

/** Pré-requisito de cada campo além do cenário (valores que o campo precisa para fazer efeito). */
const PRE: Record<string, Plano> = {
  vVaos: { preenchimentoVaos: true },
  vPerimetroPequeno: { limitePerimetroPequeno: 30 },
};

const ABAS_L2 = ["velocidade", "suporte", "outros"];
const alvos = camposVisiveis().filter((c) => ABAS_L2.includes(c.aba) && c.id !== "observacoes");

// ---------- 1. teste por campo ----------
{
  const semEfeito: string[] = [];
  let n = 0;
  for (const c of alvos) {
    let mudou = "";
    achou: for (const cen of CENARIOS)
      for (const maq of MAQS) {
        const plano = { ...base, ...cen.plano, ...(PRE[c.id] ?? {}) };
        const val = resolver({ maquina: maq, sistema: PERFIL_PADRAO, projeto: plano }).valores;
        if (!visivelAgora(c, val)) continue;
        const b0 = assinatura(maq, cen, PRE[c.id] ?? {});
        for (const alt of tentativas(c, val[c.id])) {
          if (assinatura(maq, cen, { ...(PRE[c.id] ?? {}), [c.id]: alt }) !== b0) {
            mudou = `${maq} · ${cen.nome}`;
            break achou;
          }
        }
      }
    n++;
    if (!mudou) semEfeito.push(`${c.aba}/${c.id}`);
    else console.log(`  ${c.aba}/${c.id}: muda em ${mudou}`);
  }
  ok(semEfeito.length === 0, `todo campo visível de Velocidade, Suporte e Outros (${n}) muda tempo ou massa${semEfeito.length ? " — SEM EFEITO: " + semEfeito.join(", ") : ""}`);
}

// ---------- 2. o que não muda o orçamento fica escondido ----------
{
  const todos = new Set(["qualidade", "resistencia", "velocidade", "suporte", "multimaterial", "outros"].flatMap((a) => gruposDoPainel(a as never, "especialista").flatMap((g) => g.campos.map((c) => c.id))));
  const ocultos = ESQUEMA.filter((c) => ABAS_L2.includes(c.aba) && c.estado === "oculto");
  ok(ocultos.length >= 40, `${ocultos.length} campos de Velocidade, Suporte e Outros sem efeito no orçamento estão ocultos`);
  ok(ocultos.every((c) => !todos.has(c.id)), "…e não aparecem em nenhum nível da tela");
  const busca = ["jangada", "estilo", "felpuda", "espiral", "saia voltas", "orelhas", "suavizar", "sequencia"].flatMap((q) => buscarCampos(q).flatMap((g) => g.campos)).filter((c) => ABAS_L2.includes(c.aba));
  ok(busca.every((c) => c.estado !== "oculto"), "…nem na busca");
  const selos = camposVisiveis().filter((c) => ABAS_L2.includes(c.aba) && c.estado === "naoAplicado");
  ok(selos.length === 0, `nenhum selo 🔶 nas abas Velocidade, Suporte e Outros${selos.length ? " — " + selos.map((c) => c.id).join(", ") : ""}`);
  // ocultos guardam o valor de fábrica (importar perfil não perde) e o motor ignora
  for (const m of MAQS) {
    const b = planoBase(m);
    ok(ocultos.every((c) => c.id in b && valorValido(c, b[c.id])), `${m}: todo oculto tem valor de fábrica válido guardado`);
  }
  const c0 = CENARIOS[1];
  ok(assinatura("bbl-p1s", c0, {}) === assinatura("bbl-p1s", c0, { suporteEstilo: "organico", jangadaCamadas: 3, saiaVoltas: 4, bordaTipo: "pintada", peleFelpuda: "contorno", sequenciaImpressao: "porObjeto" }), "valor num campo oculto não muda o resultado (fica só guardado)");
}

// ---------- 3. salvar e reabrir (perfil do usuário e projeto) ----------
{
  const m = "bbl-p1s";
  let plano: Plano = {};
  for (const [id, v] of [["vParedeExt", 120], ["aParedeExt", 3000], ["jParedeExt", 7], ["vBalanco.1", 25], ["vPonte", 30], ["suporte", "normal"], ["anguloSuporte", 45], ["espacoSuporte", 3], ["borda", true], ["bordaLargura", 8], ["saia", true], ["saiaDistancia", 5], ["vSaia", 40]] as [string, Valor][]) plano = definirValor(m, plano, id, v);
  const cen = CENARIOS[1];
  const direto = assinatura(m, { ...cen, plano: {} }, plano);
  // perfil do usuário: guarda só as diferenças do perfil (suporte, borda e saia são do projeto)
  const dif = diferencasParaPerfil(planoBase(m), valoresDoPlano(m, plano));
  ok(!("suporte" in dif) && !("borda" in dif) && !("saia" in dif) && dif.vParedeExt === 120 && dif.vSaia === 40, `perfil do usuário guarda ${Object.keys(dif).length} diferenças (sem suporte, borda e saia)`);
  let lib = salvarPerfil(perfisVazios(), { ...novoPerfil("Rápido", PERFIL_PADRAO, "u1"), diferencas: dif });
  lib = lerPerfis(empacotarPerfis(lib));
  const u: PerfilUsuario = perfisAtivos(lib)[0];
  ok(!!u && u.nome === "Rápido" && Object.keys(u.diferencas).length === Object.keys(dif).length, "perfil salvo e reaberto do arquivo .wjprf com todas as diferenças");
  const reaberto = (() => {
    const res = resolver({ maquina: m, sistema: PERFIL_PADRAO, usuario: u, projeto: { ...base, ...cen.plano } });
    const mq = { ...maquinaPorId(m), processo: res.processo };
    const { r } = fatiarPlaca([{ nome: cen.nome, malha: cen.malha, posicoes: [[0, 0]] }], mq, materialDa(mq, "pla"), ajustesDe(res), undefined, { filamentos: filamentosPadrao("pla", 120), troca: mq.troca });
    return [r.tempoS, r.massaG, r.custo, r.trocas.total, ...r.cores.map((x) => x.massaG)].map((x) => +Number(x).toPrecision(9)).join("|");
  })();
  const semPerfil = assinatura(m, cen, {});
  ok(reaberto !== semPerfil, "o perfil reaberto muda o resultado em relação ao padrão");
  // o mesmo resultado quando as diferenças vêm do perfil + as do projeto (suporte, borda e saia) ou todas do projeto
  const cenSem = { ...cen, plano: { suporte: "normal", borda: true, saia: true } as Plano };
  const viaPerfil = (() => {
    const res = resolver({ maquina: m, sistema: PERFIL_PADRAO, usuario: u, projeto: { ...base, ...cenSem.plano, bordaLargura: 8, saiaDistancia: 5, anguloSuporte: 45, espacoSuporte: 3 } });
    const mq = { ...maquinaPorId(m), processo: res.processo };
    const { r } = fatiarPlaca([{ nome: cen.nome, malha: cen.malha, posicoes: [[0, 0]] }], mq, materialDa(mq, "pla"), ajustesDe(res), undefined, { filamentos: filamentosPadrao("pla", 120), troca: mq.troca });
    return [r.tempoS, r.massaG, r.custo, r.trocas.total, ...r.cores.map((x) => x.massaG)].map((x) => +Number(x).toPrecision(9)).join("|");
  })();
  ok(viaPerfil.length > 0 && Number.isFinite(Number(viaPerfil.split("|")[0])), "perfil + projeto resolvem sem NaN");
  // projeto .wjslc: grava as diferenças e reabre com o mesmo resultado
  const proj: ProjetoSlicer = { nome: "teste", maquina: m, material: "pla", perfil: plano, precos: {}, filamentos: filamentosPadrao("pla", 120), trocas: {}, pecas: [{ nome: "T", copias: 1, pos: T.pos, tri: T.tri, cores: new Uint8Array(T.tri.length / 3) }] };
  const volta = await desempacotar(await empacotar(proj));
  ok(JSON.stringify(volta.perfil) === JSON.stringify(plano), "projeto salvo e reaberto guarda as mesmas diferenças (velocidades, suporte, borda e saia)");
  ok(assinatura(m, { ...cen, plano: {} }, volta.perfil) === direto, "projeto reaberto: tempo e massa idênticos");
}

console.log(falhas ? `\n${falhas} falha(s)` : "\nTudo certo.");
process.exit(falhas ? 1 : 0);
