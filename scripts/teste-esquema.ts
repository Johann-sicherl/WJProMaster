// WJSlicer3D L0: esquema de parâmetros, perfis em camadas, perfis do usuário (.wjprf) e migração dos ajustes antigos.
// Conferido em Node. As medidas "ANTES" (cubo 20 mm e cilindro Ø20×20, P1S e Kobra 3, PLA, 0,20 Padrão e uma variação com
// 0,12 mm + suporte + borda + saia + 3 paredes) foram tiradas ANTES desta fatia mexer em qualquer arquivo: tempo e massa
// têm de ser idênticos depois.
import { ESQUEMA, ABAS_PROCESSO, achatar, camposDoProcesso, camposVisiveis, desachatar, valorValido, visivelAgora, type Plano } from "../src/slicer/esquema";
import {
  ajustesDe, aplicarDiferencas, diferencas, diferencasDeAjustes, limparDiferencas, PERFIL_PADRAO, PERFIS_SISTEMA, planoBase, planoDeSistema, resolver,
  type PerfilUsuario,
} from "../src/slicer/camadas";
import { EXTENSAO_PERFIS, empacotarPerfis, excluirPerfil, juntarPerfis, lerPerfis, novoPerfil, perfisAtivos, perfisVazios, salvarPerfil } from "../src/slicer/perfisUsuario";
import { ajustesPadrao, estimar, type Ajustes, type MalhaImpressao } from "../src/slicer/fatiar";
import { MAQUINAS, materialDa, maquinaPorId } from "../src/slicer/perfis";
import { desempacotar, empacotar } from "../src/slicer/projeto";

let falhas = 0;
const ok = (cond: boolean, msg: string) => {
  if (!cond) falhas++;
  console.log(`${cond ? "✓" : "✗"} ${msg}`);
};

// ---------- 1. esquema ↔ Processo ----------
{
  const ids = new Set(ESQUEMA.map((c) => c.id));
  ok(ids.size === ESQUEMA.length, `ids únicos no esquema (${ESQUEMA.length} campos)`);
  for (const m of MAQUINAS) {
    const proc = Object.keys(achatar(m.processo));
    const faltam = proc.filter((k) => !ESQUEMA.some((c) => c.id === k && c.origem === "processo"));
    ok(faltam.length === 0, `${m.modelo}: todo campo do Processo está no esquema (${proc.length})${faltam.length ? " — faltam: " + faltam.join(", ") : ""}`);
    const sobram = ESQUEMA.filter((c) => c.origem === "processo" && !proc.includes(c.id)).map((c) => c.id);
    ok(sobram.length === 0, `${m.modelo}: todo id "processo" do esquema existe no Processo${sobram.length ? " — sobram: " + sobram.join(", ") : ""}`);
    const maq = achatar({ ...m, processo: undefined, materiais: undefined, id: undefined, marca: undefined, modelo: undefined });
    const semMaq = ESQUEMA.filter((c) => c.origem === "maquina" && !(c.id in maq)).map((c) => c.id);
    ok(semMaq.length === 0, `${m.modelo}: todo id "maquina" existe na Maquina${semMaq.length ? " — " + semMaq.join(", ") : ""}`);
    const mat = achatar(m.materiais.pla!);
    mat.precoKg = 0;
    const semMat = ESQUEMA.filter((c) => c.origem === "material" && !(c.id in mat)).map((c) => c.id);
    ok(semMat.length === 0, `${m.modelo}: todo id "material" existe no Material${semMat.length ? " — " + semMat.join(", ") : ""}`);
    // e todo campo de máquina/material tem campo no esquema
    const camposMaq = Object.keys(maq).filter((k) => maq[k] !== undefined && !ESQUEMA.some((c) => c.id === k));
    ok(camposMaq.length === 0, `${m.modelo}: todo campo da Maquina está no esquema${camposMaq.length ? " — faltam: " + camposMaq.join(", ") : ""}`);
    const camposMat = Object.keys(m.materiais.pla!).filter((k) => !ESQUEMA.some((c) => c.id === k && c.origem === "material"));
    ok(camposMat.length === 0, `${m.modelo}: todo campo do Material está no esquema${camposMat.length ? " — faltam: " + camposMat.join(", ") : ""}`);
  }
  const novos = ESQUEMA.filter((c) => c.origem === "novo");
  ok(novos.every((c) => c.estado !== "motor" && c.padrao !== undefined), `campos novos: nenhum finge funcionar (🔶/oculto) e todos têm padrão neutro (${novos.length})`);
  ok(ESQUEMA.filter((c) => c.origem === "projeto").every((c) => c.padrao !== undefined), "campos do projeto (suporte, borda, saia, observações) têm padrão");
  ok(ESQUEMA.filter((c) => c.origem === "processo").every((c) => c.estado === "motor" || ((c.estado === "parcial" || c.estado === "oculto") && !!c.nota)), "campos do Processo = motor ✅ (🟡 ou oculto só com a nota do que falta)");
  const faltaOpcao = ESQUEMA.filter((c) => c.tipo === "lista" && !c.opcoes?.length).map((c) => c.id);
  ok(faltaOpcao.length === 0 || faltaOpcao.every((id) => ["suporteTipo"].includes(id) === false), "campos de lista têm opções");
  ok(ESQUEMA.filter((c) => c.tipo === "lista").every((c) => c.opcoes?.length), "toda lista tem opções");
  ok(ESQUEMA.filter((c) => ["numero", "inteiro", "percentual"].includes(c.tipo)).every((c) => c.min !== undefined && c.max !== undefined && c.min <= c.max), "todo número tem mín/máx");
  ok(ESQUEMA.filter((c) => c.estado === "oculto").length >= 25 && camposVisiveis().every((c) => c.estado !== "oculto"), "G-code, temperaturas, ventoinhas…: ocultos e fora da lista da tela");
  const abas = new Set(camposDoProcesso().map((c) => c.aba));
  ok(ABAS_PROCESSO.every((a) => abas.has(a)), "as 6 abas (qualidade, resistência, velocidade, suporte, multimaterial, outros) têm campos");
  ok(["simples", "avancado", "especialista"].every((n) => ESQUEMA.some((c) => c.nivel === n)), "os 3 níveis aparecem");
  const grupos = new Set(ESQUEMA.map((c) => c.aba + "/" + c.grupo));
  ok(grupos.size >= 40, `grupos por aba (${grupos.size})`);
  // todos os valores de fábrica ficam dentro de mín/máx e do tipo
  for (const m of MAQUINAS) {
    const base = planoBase(m.id);
    const fora = camposDoProcesso().filter((c) => !(c.id in base) || !valorValido(c, base[c.id])).map((c) => c.id);
    ok(fora.length === 0, `${m.modelo}: todo valor de fábrica do processo é válido no esquema${fora.length ? " — " + fora.join(", ") : ""}`);
  }
  const sup = ESQUEMA.find((c) => c.id === "arvore.angulo")!;
  ok(!visivelAgora(sup, { suporte: "nenhum" }) && visivelAgora(sup, { suporte: "arvore" }), "visível se: ângulo do galho só com suporte em árvore");
  const ferro = ESQUEMA.find((c) => c.id === "ferroFluxo")!;
  ok(!visivelAgora(ferro, { ferroTipo: "nenhum" }) && visivelAgora(ferro, { ferroTipo: "todoSolido" }), "visível se: fluxo de passar ferro só quando passa ferro");
  const proc = MAQUINAS[0].processo;
  ok(JSON.stringify(desachatar(achatar(proc), proc)) === JSON.stringify(proc), "achatar → desachatar devolve o Processo igual");
}

// ---------- 2. camadas ----------
{
  const p1s = maquinaPorId("bbl-p1s");
  const r0 = resolver({ maquina: "bbl-p1s" });
  ok(JSON.stringify(r0.processo) === JSON.stringify(p1s.processo), "resolver sem diferenças = Processo de fábrica da P1S, byte a byte");
  ok(r0.suporte === "nenhum" && !r0.borda && !r0.saia, "sem diferenças: sem suporte, sem borda, sem saia");
  const usuario: PerfilUsuario = { id: "u1", nome: "Rápido", herdaDe: PERFIL_PADRAO, diferencas: { paredes: 3, vParedeExt: 150, preenchimento: 0.1 }, modificado: "2026-11-26T10:00:00Z" };
  const r1 = resolver({ maquina: "bbl-p1s", usuario });
  ok(r1.processo.paredes === 3 && r1.processo.vParedeExt === 150 && r1.processo.preenchimento === 0.1 && r1.processo.vParedeInt === p1s.processo.vParedeInt, "usuário sobrepõe o sistema; o resto vem do sistema");
  const r2 = resolver({ maquina: "bbl-p1s", usuario, projeto: { paredes: 4, saia: true }, objeto: { paredes: 5, "arvore.angulo": 30 } });
  ok(r2.processo.paredes === 5 && r2.processo.arvore.angulo === 30 && r2.processo.vParedeExt === 150 && r2.saia, "ordem: sistema → usuário → projeto → objeto");
  ok(r2.processo.arvore.diametro === p1s.processo.arvore.diametro && r2.processo.vBalanco.length === 4, "campos aninhados e listas se mantêm");
  const rh = resolver({ maquina: "bbl-p1s", usuario: { ...usuario, herdaDe: "0.12" } });
  ok(rh.processo.altura === 0.12, "usuário herda do perfil de sistema escolhido (0,12 mm)");
  const rz = resolver({ maquina: "bbl-p1s", objeto: { paredes: 3 }, modificadores: [{ nome: "base", zMin: 0, zMax: 5, diferencas: { paredes: 6 } }, { zMin: 5, zMax: 9999, diferencas: { preenchimento: 0.4 } }] });
  ok(rz.processo.paredes === 3 && rz.faixas.length === 2 && rz.faixas[0].valores.paredes === 6 && rz.faixas[1].valores.paredes === 3 && rz.faixas[1].valores.preenchimento === 0.4, "faixa de Z: estrutura resolvida sobre o objeto, sem mexer no Processo");
  const rx = resolver({ maquina: "bbl-p1s", projeto: { paredes: 99, naoExiste: 1, altura: "x", padrao: "inventado", preenchimento: 0.3 } });
  ok(rx.processo.paredes === p1s.processo.paredes && rx.processo.altura === p1s.processo.altura && rx.processo.padrao === p1s.processo.padrao && rx.processo.preenchimento === 0.3, "valores fora do esquema, do tipo ou dos limites são descartados");
  ok(resolver({ maquina: "bbl-p1s", usuario: { ...usuario, excluido: true } }).processo.paredes === p1s.processo.paredes, "perfil de usuário excluído não vale");
  // diferenças ↔ aplicar
  const base = planoDeSistema("acu-k3", PERFIL_PADRAO);
  const atual = { ...base, paredes: 4, padrao: "giroide", borda: true, "vBalanco.1": 40, "arvore.diametro": 3 };
  const d = diferencas(base, atual);
  ok(Object.keys(d).length === 5 && d.paredes === 4 && d["vBalanco.1"] === 40, "diferencas: só o que mudou");
  ok(JSON.stringify(aplicarDiferencas(base, d)) === JSON.stringify(atual), "diferencas ↔ aplicarDiferencas: ida e volta");
  ok(Object.keys(diferencas(base, base)).length === 0, "sem alteração = nenhuma diferença (selo ↺ apagado)");
  ok(Object.keys(limparDiferencas({ paredes: 2, x: 1 })).join() === "paredes", "limparDiferencas descarta o que não é do esquema");
  // 9 perfis × 2 máquinas
  ok(PERFIS_SISTEMA.length === 9, "9 perfis de sistema");
  for (const m of MAQUINAS) {
    for (const ps of PERFIS_SISTEMA) {
      const v = planoDeSistema(m.id, ps.id);
      const fora = camposDoProcesso().filter((c) => !valorValido(c, v[c.id])).map((c) => c.id);
      const esp = Math.max((v.topo as number) * (v.altura as number), 0);
      ok(fora.length === 0 && v.altura === ps.altura && v.alturaPrimeira === 0.2 && esp >= (m.processo.topo * 0.2 - 1e-9), `${m.modelo} · ${ps.nome}: valores válidos, camada ${ps.altura} mm, 1ª camada 0,20, topo ${v.topo}/fundo ${v.fundo} camadas`);
    }
    ok(JSON.stringify(resolver({ maquina: m.id, sistema: PERFIL_PADRAO }).processo) === JSON.stringify(m.processo), `${m.modelo} · 0,20 mm Padrão é idêntico ao Processo de hoje`);
    const v08 = planoDeSistema(m.id, "0.08"), v28 = planoDeSistema(m.id, "0.28");
    ok(v08.vParedeExt === m.processo.vParedeExt && v28.aPadrao === m.processo.aPadrao && v08.fluxoTopo === m.processo.fluxoTopo, `${m.modelo}: velocidades, acelerações e fluxos não são inventados (iguais ao padrão)`);
  }
}

// ---------- 3. cubo e cilindro idênticos aos de antes ----------
{
  const cubo = (): MalhaImpressao => {
    const pos: number[] = [], tri: number[] = [];
    for (const z of [0, 20]) for (const y of [0, 20]) for (const x of [0, 20]) pos.push(x, y, z);
    for (const [a, b, c, d] of [[0, 2, 3, 1], [4, 5, 7, 6], [0, 1, 5, 4], [2, 6, 7, 3], [0, 4, 6, 2], [1, 3, 7, 5]]) tri.push(a, b, c, a, c, d);
    return { pos: Float32Array.from(pos), tri: Uint32Array.from(tri) };
  };
  const cilindro = (R: number, H: number, n = 128): MalhaImpressao => {
    const pos: number[] = [0, 0, 0, 0, 0, H];
    for (let k = 0; k < n; k++) {
      const a = (2 * Math.PI * k) / n;
      pos.push(R * Math.cos(a), R * Math.sin(a), 0, R * Math.cos(a), R * Math.sin(a), H);
    }
    const tri: number[] = [];
    for (let k = 0; k < n; k++) {
      const b0 = 2 + 2 * k, t0 = b0 + 1, b1 = 2 + 2 * ((k + 1) % n), t1 = b1 + 1;
      tri.push(0, b1, b0, 1, t0, t1, b0, b1, t1, b0, t1, t0);
    }
    return { pos: Float32Array.from(pos), tri: Uint32Array.from(tri) };
  };
  // medidas de ANTES (padrão: tempo s, massa g, camadas | variação: 0,12 mm + suporte normal + borda + saia + 3 paredes)
  const ANTES: Record<string, [number, number, number, number, number, number]> = {
    "bbl-p1s cubo": [448.4882124366969, 3.5694883434303946, 100, 748.2024989189815, 4.366901064914955, 166],
    "bbl-p1s cilindro": [432.54714235484005, 2.8800808290131004, 100, 724.3920045610269, 3.487780968932579, 166],
    "acu-k3 cubo": [839.6080841847775, 3.5736743340414048, 100, 1400.0151599988828, 4.4033309678041, 166],
    "acu-k3 cilindro": [815.8028698864206, 2.7247201269232315, 100, 1365.2389095438143, 3.351886973727491, 166],
  };
  const variacao: Plano = { altura: 0.12, suporte: "normal", borda: true, saia: true, paredes: 3 };
  for (const m of MAQUINAS) {
    const mat = materialDa(m, "pla");
    for (const [nome, malha] of [["cubo", cubo()], ["cilindro", cilindro(10, 20)]] as const) {
      const a = ANTES[`${m.id} ${nome}`];
      // caminho novo (o do worker): Processo e ajustes saem de resolver()
      const r = resolver({ maquina: m.id, projeto: {} });
      const x = estimar(malha, { ...m, processo: r.processo }, mat, ajustesDe(r));
      ok(x.tempoS === a[0] && x.massaG === a[1] && x.camadas === a[2], `${m.modelo} ${nome} Ø20×20: ${x.tempoS.toFixed(2)} s e ${x.massaG.toFixed(3)} g IDÊNTICOS aos de antes`);
      const r2 = resolver({ maquina: m.id, projeto: variacao });
      const y = estimar(malha, { ...m, processo: r2.processo }, mat, ajustesDe(r2));
      ok(y.tempoS === a[3] && y.massaG === a[4] && y.camadas === a[5], `${m.modelo} ${nome} (0,12 mm, suporte, borda, saia, 3 paredes): ${y.tempoS.toFixed(2)} s e ${y.massaG.toFixed(3)} g idênticos aos de antes`);
      // o perfil de sistema 0,12 mm = altura 0,12 sobre o padrão + camadas de topo/fundo que mantêm a espessura em mm
      const sis = planoDeSistema(m.id, "0.12");
      const r3 = resolver({ maquina: m.id, sistema: "0.12", projeto: { suporte: "normal", borda: true, saia: true, paredes: 3 } });
      const r4 = resolver({ maquina: m.id, projeto: { ...variacao, topo: sis.topo, fundo: sis.fundo } });
      const z = estimar(malha, { ...m, processo: r3.processo }, mat, ajustesDe(r3)), w = estimar(malha, { ...m, processo: r4.processo }, mat, ajustesDe(r4));
      ok(z.tempoS === w.tempoS && z.massaG === w.massaG && z.massaG >= y.massaG, `${m.modelo} ${nome}: perfil de sistema 0,12 mm = altura 0,12 + topo ${sis.topo}/fundo ${sis.fundo} camadas (mesma espessura em mm)`);
    }
  }
}

// ---------- 4. migração ----------
{
  const m = maquinaPorId("acu-k3");
  const antigo: Ajustes = { ...ajustesPadrao(m.processo), altura: 0.12, paredes: 4, padrao: "giroide", suporte: "arvore", borda: true, preenchimento: 0.25 };
  const d = diferencasDeAjustes("acu-k3", antigo);
  ok(Object.keys(d).sort().join() === "altura,borda,padrao,paredes,preenchimento,suporte", `ajustes antigos viram diferenças sobre o 0,20 Padrão (${Object.keys(d).join(", ")})`);
  const volta = ajustesDe(resolver({ maquina: "acu-k3", projeto: d }));
  ok(JSON.stringify(volta) === JSON.stringify(antigo), "ajustes → diferenças → resolver devolve os mesmos ajustes (nada se perde)");
  ok(Object.keys(diferencasDeAjustes("acu-k3", ajustesPadrao(m.processo))).length === 0, "ajustes de fábrica = nenhuma diferença");
  ok(diferencasDeAjustes("acu-k3", { suporte: true }).suporte === m.processo.suporteTipo, "suporte antigo sim/não vira o tipo do perfil");
  ok(Object.keys(diferencasDeAjustes("acu-k3", undefined)).length === 0 && Object.keys(diferencasDeAjustes("acu-k3", {})).length === 0, "projeto sem ajustes abre com o padrão");

  // .wjslc antigo (campo `ajustes` inteiro, versão 1) abre igual
  const malha = { pos: Float32Array.from([0, 0, 0, 10, 0, 0, 0, 10, 0, 0, 0, 10]), tri: Uint32Array.from([0, 1, 2, 0, 1, 3, 1, 2, 3, 0, 2, 3]) };
  const velho = JSON.stringify({
    formato: "wjslc", versao: 1, nome: "Velho",
    config: { maquina: "acu-k3", material: "petg", ajustes: antigo, precos: {}, filamentos: [], trocas: {} },
    pecas: [{ nome: "P", copias: 1, nv: 4, nt: 4, gz: false, dados: Buffer.concat([Buffer.from(malha.pos.buffer), Buffer.from(malha.tri.buffer), Buffer.from(new Uint8Array(4))]).toString("base64") }],
  });
  const p = await desempacotar(velho);
  ok(JSON.stringify(ajustesDe(resolver({ maquina: p.maquina, projeto: p.perfil }))) === JSON.stringify(antigo), ".wjslc antigo: abre com os mesmos ajustes");
  ok(Object.keys(p.perfil).length === 6, ".wjslc antigo: perfil do projeto = só as diferenças");
  // projeto novo grava as diferenças (e a cópia `ajustes` para app antigo) e volta igual
  const novo = await empacotar({ ...p, nome: "Novo" });
  const j = JSON.parse(novo);
  ok(j.versao === 2 && JSON.stringify(j.config.perfil) === JSON.stringify(p.perfil) && j.config.ajustes.altura === 0.12, "projeto novo grava o perfil (só diferenças) e a cópia de ajustes");
  const p2 = await desempacotar(novo);
  ok(JSON.stringify(p2.perfil) === JSON.stringify(p.perfil), "projeto novo: ida e volta igual");
  const sem = await desempacotar(JSON.stringify({ ...JSON.parse(velho), config: { maquina: "acu-k3" } }));
  ok(Object.keys(sem.perfil).length === 0, ".wjslc sem ajustes (versão bem antiga) abre com o padrão");
  const sujo = await desempacotar(JSON.stringify({ ...JSON.parse(novo), config: { ...j.config, perfil: { paredes: 99, lixo: 1, padrao: "cubico" } } }));
  ok(JSON.stringify(sujo.perfil) === JSON.stringify({ padrao: "cubico" }), "perfil do projeto com valor fora do esquema: só o válido fica");
}

// ---------- 5. perfis do usuário (.wjprf) ----------
{
  let a = perfisVazios();
  const p1 = { ...novoPerfil("Letras", "0.12", "u-a"), diferencas: { paredes: 4, padrao: "giroide" }, modificado: "2026-11-26T10:00:00.000Z" };
  const p2 = { ...novoPerfil("Rápido", PERFIL_PADRAO, "u-b"), diferencas: { vParedeExt: 150 }, modificado: "2026-11-26T10:00:00.000Z" };
  a = { ...a, perfis: [p1, p2] };
  const volta = lerPerfis(empacotarPerfis(a));
  ok(volta.formato === EXTENSAO_PERFIS && JSON.stringify(volta) === JSON.stringify(a), ".wjprf: ida e volta igual");
  let erro = "";
  try { lerPerfis("{}"); } catch (e) { erro = (e as Error).message; }
  ok(erro.includes("não é uma lista de perfis"), ".wjprf: arquivo estranho recusado com mensagem clara");
  const sujo = lerPerfis(JSON.stringify({ formato: "wjprf", versao: 1, perfis: [{ id: "x", nome: "Bom", herdaDe: "nao-existe", diferencas: { paredes: 3, lixo: 1 }, modificado: "" }, { id: "x", nome: "Repetido" }, { nome: "Sem id" }, null] }));
  ok(sujo.perfis.length === 1 && sujo.perfis[0].herdaDe === PERFIL_PADRAO && JSON.stringify(sujo.perfis[0].diferencas) === '{"paredes":3}', ".wjprf: perfil inválido descartado; herança e diferenças limpas");
  // junção: a mais recente vence
  const b = { ...perfisVazios(), perfis: [{ ...p1, nome: "Letras (tablet)", diferencas: { paredes: 5 }, modificado: "2026-11-26T11:00:00.000Z" }, { ...p2, modificado: "2026-11-26T09:00:00.000Z", diferencas: { vParedeExt: 100 } }, { ...novoPerfil("Só no tablet", PERFIL_PADRAO, "u-c"), modificado: "2026-11-26T08:00:00.000Z" }] };
  const j = juntarPerfis(a, b);
  const g = (id: string) => j.perfis.find((x) => x.id === id)!;
  ok(j.perfis.length === 3 && g("u-a").nome === "Letras (tablet)" && g("u-a").diferencas.paredes === 5, "junção: o perfil mais recente vence");
  ok(g("u-b").diferencas.vParedeExt === 150 && g("u-c").nome === "Só no tablet", "junção: o mais antigo perde e o que só existe num aparelho entra");
  ok(JSON.stringify(juntarPerfis(a, a)) === JSON.stringify(a), "junção com ela mesma não muda nada");
  // exclusão propaga
  const ex = excluirPerfil(a, "u-a");
  ok(perfisAtivos(ex).length === 1 && ex.perfis.length === 2, "excluir marca o perfil (some da lista)");
  const dep = juntarPerfis({ ...b, perfis: [{ ...b.perfis[0], modificado: "2026-11-26T09:30:00.000Z" }] }, { ...ex, perfis: ex.perfis.map((x) => ({ ...x, modificado: x.excluido ? "2999-01-01T00:00:00.000Z" : x.modificado })) });
  ok(perfisAtivos(dep).every((x) => x.id !== "u-a"), "a exclusão mais recente vence na junção");
  const salvo = salvarPerfil(a, { ...p2, diferencas: { vParedeExt: 120 } });
  ok(salvo.perfis.length === 2 && salvo.perfis.find((x) => x.id === "u-b")!.diferencas.vParedeExt === 120 && salvo.perfis.find((x) => x.id === "u-b")!.modificado > p2.modificado, "salvar troca o perfil e marca a hora");
}

console.log(falhas ? `\n${falhas} falha(s)` : "\nTudo certo.");
process.exit(falhas ? 1 : 0);
