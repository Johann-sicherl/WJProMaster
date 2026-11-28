// WJSlicer3D L1b: painel de processo gerado do esquema (src/slicer/painel.ts, lógica pura). Conferido em Node.
// Critério: todo campo visível do esquema aparece (uma vez só) nas seis abas; ocultos (⚪/⛔) e ⚙ de Impressora/Filamento nunca;
// níveis Simples ⊂ Avançado ⊂ Especialista; os 15 parâmetros COSTURA_PADRAO da M2 têm tela; busca sem acento; texto ↔ valor;
// plano de diferenças (editar, ↺, trocar de perfil, perfil do usuário) e o valor editado chega ao Processo que o motor recebe.
import { ABAS_PROCESSO, ESQUEMA, NOMES_ABAS, camposVisiveis, valorValido, visivelAgora, type Aba, type Campo } from "../src/slicer/esquema";
import { PERFIL_PADRAO, ajustesDe, planoBase, planoDeSistema, resolver } from "../src/slicer/camadas";
import { COSTURA_PADRAO, MAQUINAS } from "../src/slicer/perfis";
import {
  FORA_DO_PERFIL, NIVEIS, alterados, aplicarValoresDoPerfil, buscarCampos, camposDoPainel, definirValor, diferencasParaPerfil, grupoComecaAberto,
  gruposDoPainel, limitesDaCaixa, noNivel, textoParaValor, valorParaTexto, valoresDoPlano, voltarCampos,
} from "../src/slicer/painel";

let falhas = 0;
const ok = (cond: boolean, msg: string) => {
  if (!cond) falhas++;
  console.log(`${cond ? "✓" : "✗"} ${msg}`);
};
const idsDe = (gs: { campos: Campo[] }[]) => gs.flatMap((g) => g.campos.map((c) => c.id));

// ---------- 1. todo campo visível aparece (Especialista = tudo) ----------
{
  const esperados = camposVisiveis().filter((c) => (ABAS_PROCESSO as Aba[]).includes(c.aba));
  const vistos = ABAS_PROCESSO.flatMap((a) => idsDe(gruposDoPainel(a, "especialista")));
  ok(vistos.length === new Set(vistos).size, `nenhum campo aparece duas vezes (${vistos.length})`);
  const faltam = esperados.filter((c) => !vistos.includes(c.id)).map((c) => c.id);
  ok(faltam.length === 0, `todo campo visível do esquema aparece nas 6 abas (${esperados.length})${faltam.length ? " — faltam: " + faltam.join(", ") : ""}`);
  ok(vistos.length === esperados.length, "a tela não mostra campo que o esquema não tem");
  const ocultos = ESQUEMA.filter((c) => c.estado === "oculto");
  ok(ocultos.length > 10 && ocultos.every((c) => !vistos.includes(c.id)), `${ocultos.length} campos ocultos (⚪/⛔) nunca aparecem`);
  ok(vistos.every((id) => !["impressora", "filamento"].includes(ESQUEMA.find((c) => c.id === id)!.aba)), "⚙ Impressora e Filamento ficam de fora (L3)");
  for (const a of ABAS_PROCESSO) ok(gruposDoPainel(a, "especialista").length > 0, `aba ${NOMES_ABAS[a]}: ${gruposDoPainel(a, "especialista").length} grupos, ${idsDe(gruposDoPainel(a, "especialista")).length} campos`);
  ok(camposDoPainel().length === esperados.length, "camposDoPainel = campos visíveis das 6 abas");
  // cada campo tem valor de fábrica válido em todas as impressoras (a tela nunca abre vazia nem fora dos limites)
  for (const m of MAQUINAS) {
    const base = planoBase(m.id);
    const ruins = esperados.filter((c) => !(c.id in base) || !valorValido(c, base[c.id])).map((c) => c.id);
    ok(ruins.length === 0, `${m.modelo}: todo campo da tela tem valor de fábrica válido${ruins.length ? " — " + ruins.join(", ") : ""}`);
  }
  // "visível se" aponta para campo que existe
  const mortos = esperados.filter((c) => c.visivelSe && !ESQUEMA.some((o) => o.id === c.visivelSe!.split(/!?=/)[0])).map((c) => c.id);
  ok(mortos.length === 0, "todo \"visível se\" aponta para um campo do esquema");
}

// ---------- 2. níveis ----------
{
  const cont = NIVEIS.map((n) => ABAS_PROCESSO.reduce((s, a) => s + idsDe(gruposDoPainel(a, n)).length, 0));
  ok(cont[0] > 20 && cont[0] < cont[1] && cont[1] < cont[2], `Simples (${cont[0]}) < Avançado (${cont[1]}) < Especialista (${cont[2]})`);
  const simples = new Set(ABAS_PROCESSO.flatMap((a) => idsDe(gruposDoPainel(a, "simples"))));
  const avancado = new Set(ABAS_PROCESSO.flatMap((a) => idsDe(gruposDoPainel(a, "avancado"))));
  ok([...simples].every((id) => avancado.has(id)), "Simples ⊂ Avançado");
  // tudo o que a L1a mostrava continua visível no nível Simples
  const l1a = ["altura", "paredes", "topo", "fundo", "preenchimento", "padrao", "suporte", "borda", "saia"];
  ok(l1a.every((id) => simples.has(id)), "os 9 campos da L1a estão no nível Simples");
  ok(ESQUEMA.filter((c) => c.estado !== "oculto").every((c) => noNivel(c, "especialista")), "Especialista mostra tudo");
  const g0 = gruposDoPainel("resistencia", "simples")[0];
  ok(grupoComecaAberto(g0), "grupo com campo Simples começa aberto");
  const soEsp = gruposDoPainel("qualidade", "especialista").find((g) => g.campos.every((c) => c.nivel === "especialista"));
  ok(!soEsp || !grupoComecaAberto(soEsp), "grupo só de Especialista começa recolhido");
}

// ---------- 3. os 15 parâmetros da costura (M2) têm tela ----------
{
  const chaves = Object.keys(COSTURA_PADRAO);
  const vistos = new Set(ABAS_PROCESSO.flatMap((a) => idsDe(gruposDoPainel(a, "especialista"))));
  ok(chaves.length === 15, "COSTURA_PADRAO tem 15 parâmetros");
  ok(chaves.every((k) => vistos.has(k)), "os 15 parâmetros da costura aparecem no painel");
  const noQualidade = new Set(idsDe(gruposDoPainel("qualidade", "especialista")));
  ok(chaves.every((k) => noQualidade.has(k)), "…na aba Qualidade (Costura e Paredes e pontes)");
  const rampa = ESQUEMA.find((c) => c.id === "costuraRampaAltura")!;
  const v = valoresDoPlano("bbl-p1s", {});
  ok(!visivelAgora(rampa, v), "campos da rampa só aparecem com a costura em rampa ligada");
  ok(visivelAgora(rampa, { ...v, costuraRampaTipo: "contorno" }), "…e aparecem ao escolher contorno");
}

// ---------- 4. busca ----------
{
  const ids = (q: string) => idsDe(buscarCampos(q));
  ok(ids("costura").includes("costuraPosicao") && ids("costura").includes("costuraRampaTipo"), "busca \"costura\" acha a costura");
  ok(ids("pe de elefante").includes("peDeElefante") && ids("pé de elefante").includes("peDeElefante"), "busca sem acento e com acento acha o pé de elefante");
  ok(ids("ferro").includes("ferroTipo"), "busca \"ferro\" acha passar ferro (🔶 também aparece)");
  ok(ids("COSTURA POSICAO").includes("costuraPosicao"), "busca ignora maiúsculas e exige todas as palavras");
  ok(ids("zzzxx").length === 0 && buscarCampos("").length === 0, "busca sem resultado e busca vazia");
  ok(ids("g-code").length === 0 && ids("temperatura").length === 0 && ids("time-lapse").length === 0 && ids("ventoinha").length === 0, "a busca nunca mostra campo oculto (G-code, temperaturas, ventoinhas)");
  const sup = buscarCampos("suporte");
  ok(sup.some((g) => g.aba === "suporte") && sup.some((g) => g.aba !== "suporte"), "a busca percorre todas as abas");
  const todos = new Set(ABAS_PROCESSO.flatMap((a) => idsDe(gruposDoPainel(a, "especialista"))));
  ok(ids("a").every((id) => todos.has(id)), "toda a busca devolve só campos do painel");
}

// ---------- 5. texto ↔ valor ----------
{
  const c = (id: string) => ESQUEMA.find((x) => x.id === id)!;
  ok(textoParaValor(c("altura"), "0,12") === 0.12 && textoParaValor(c("altura"), " 0.2 ") === 0.2, "vírgula e ponto decimal");
  ok(textoParaValor(c("altura"), "9") === 0.4 && textoParaValor(c("altura"), "0") === 0.04, "fora dos limites vira o limite");
  ok(textoParaValor(c("paredes"), "3,6") === 4, "inteiro arredonda");
  ok(textoParaValor(c("preenchimento"), "15") === 0.15 && valorParaTexto(c("preenchimento"), 0.15) === "15", "percentual: 15 % ↔ 0,15");
  ok(textoParaValor(c("costuraVao"), "250") === 1, "percentual limitado a 100 %");
  ok(valorParaTexto(c("preenchimento"), 0.15000000000000002) === "15", "sem ruído de ponto flutuante");
  ok(textoParaValor(c("altura"), "abc") === undefined && textoParaValor(c("altura"), "") === undefined, "texto inválido → nada");
  ok(textoParaValor(c("observacoes"), "olá") === "olá", "texto livre");
  const lim = limitesDaCaixa(c("costuraVao"));
  ok(lim.min === 0 && lim.max === 100, "limites da caixa em % para percentual");
  // todo campo numérico: valor de fábrica ↔ texto ↔ valor volta igual
  const ruins = camposDoPainel().filter((x) => ["numero", "inteiro", "percentual"].includes(x.tipo)).filter((x) => {
    const v = planoBase("bbl-p1s")[x.id];
    return textoParaValor(x, valorParaTexto(x, v)) !== v;
  }).map((x) => x.id);
  ok(ruins.length === 0, `valor de fábrica → texto → valor volta igual em todo campo numérico${ruins.length ? " — " + ruins.join(", ") : ""}`);
}

// ---------- 6. plano de diferenças, ↺, perfis ----------
{
  const m = "bbl-p1s";
  let plano = {} as Record<string, number | boolean | string>;
  ok(alterados(valoresDoPlano(m, plano), valoresDoPlano(m, plano)).length === 0, "sem mudança: nada alterado");
  plano = definirValor(m, plano, "paredes", 4);
  plano = definirValor(m, plano, "costuraPosicao", "alinhada");
  plano = definirValor(m, plano, "vBalanco.1", 33);
  plano = definirValor(m, plano, "ferroTipo", "todasTopo"); // 🔶: guardado, não muda o motor
  plano = definirValor(m, plano, "borda", true);
  ok(Object.keys(plano).length === 5, `só as diferenças ficam no plano (${Object.keys(plano).join(", ")})`);
  ok(definirValor(m, plano, "paredes", 999) === plano && definirValor(m, plano, "naoExiste", 1) === plano, "valor fora dos limites ou campo desconhecido: plano igual");
  ok(definirValor(m, plano, "paredes", 2)["paredes"] === undefined, "voltar ao valor de fábrica tira do plano");
  const perfil = valoresDoPlano(m, {});
  const v = valoresDoPlano(m, plano);
  const alt = alterados(perfil, v);
  ok(alt.length === 4 && !alt.includes("borda"), `selo ↺: 4 alterados, a borda (do projeto) não conta — ${alt.join(", ")}`);
  ok(ABAS_PROCESSO.every((a) => alt.filter((id) => ESQUEMA.find((c) => c.id === id)!.aba === a).length >= 0) && ESQUEMA.find((c) => c.id === "ferroTipo")!.aba === "qualidade", "cada alterado sabe a sua aba");
  const volta = voltarCampos(m, plano, perfil, ["costuraPosicao", "vBalanco.1"]);
  ok(valoresDoPlano(m, volta).costuraPosicao === "maisProxima" && valoresDoPlano(m, volta).paredes === 4 && alterados(perfil, valoresDoPlano(m, volta)).length === 2, "↺ de um campo volta só ele");
  const tudo = voltarCampos(m, plano, perfil, alt);
  ok(alterados(perfil, valoresDoPlano(m, tudo)).length === 0 && valoresDoPlano(m, tudo).borda === true, "↺ do perfil volta tudo (menos suporte/borda/saia)");
  // trocar de perfil: valores do perfil, mas suporte/borda/saia ficam
  const h012 = planoDeSistema(m, "0.12");
  const troca = aplicarValoresDoPerfil(m, plano, h012);
  const vt = valoresDoPlano(m, troca);
  ok(vt.altura === 0.12 && vt.paredes === h012.paredes && vt.costuraPosicao === "maisProxima" && vt.borda === true, "trocar de perfil traz os valores dele e mantém a borda do projeto");
  ok(FORA_DO_PERFIL.has("suporte") && FORA_DO_PERFIL.has("borda") && FORA_DO_PERFIL.has("saia"), "suporte, borda e saia são do projeto");
  // perfil do usuário: só diferenças dos campos do perfil
  const dif = diferencasParaPerfil(planoDeSistema(m), v);
  ok(Object.keys(dif).sort().join() === ["costuraPosicao", "ferroTipo", "paredes", "vBalanco.1"].sort().join(), `perfil do usuário guarda 4 diferenças (sem a borda) — ${Object.keys(dif).join(", ")}`);
  const reaplicado = valoresDoPlano(m, aplicarValoresDoPerfil(m, {}, resolver({ maquina: m, sistema: PERFIL_PADRAO, usuario: { id: "u", nome: "x", herdaDe: PERFIL_PADRAO, diferencas: dif, modificado: "2026-11-28T00:00:00Z" } }).valores));
  ok(reaplicado.paredes === 4 && reaplicado.costuraPosicao === "alinhada" && reaplicado.ferroTipo === "todasTopo", "perfil do usuário reaplicado traz os valores");
}

// ---------- 7. o valor editado chega ao motor ----------
{
  for (const mq of MAQUINAS) {
    const plano = definirValor(mq.id, definirValor(mq.id, definirValor(mq.id, {}, "costuraPosicao", "aleatoria"), "lParedeExt", 0.5), "vParedeExt", 77);
    const res = resolver({ maquina: mq.id, sistema: PERFIL_PADRAO, projeto: plano }); // como o worker
    ok(res.processo.costuraPosicao === "aleatoria" && res.processo.lParedeExt === 0.5 && res.processo.vParedeExt === 77, `${mq.modelo}: costura, largura e velocidade editadas chegam ao Processo do motor`);
    ok(ajustesDe(res).paredes === mq.processo.paredes, `${mq.modelo}: o resto continua o de fábrica`);
    const limpo = resolver({ maquina: mq.id, sistema: PERFIL_PADRAO, projeto: {} });
    ok(JSON.stringify(limpo.processo) === JSON.stringify(mq.processo), `${mq.modelo}: sem edição o Processo é exatamente o de fábrica`);
  }
  const base = planoBase("bbl-p1s");
  ok(Object.keys(definirValor("bbl-p1s", {}, "ferroTipo", "todoSolido")).length === 1 && base.ferroTipo === "nenhum", "campo 🔶 guarda o valor sem tocar nos demais");
}

console.log(falhas ? `\n${falhas} falha(s)` : "\nTudo certo.");
process.exit(falhas ? 1 : 0);
