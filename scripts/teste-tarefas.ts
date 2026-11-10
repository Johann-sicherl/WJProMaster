// Teste das regras do WJTaskPlan em Node: árvore de pastas (mover, ciclos, excluir), estados com
// histórico datado, tempo de atendimento, painel, alertas de prazo, prazo da etapa ≤ prazo da tarefa
// (alerta de mão dupla), etapas em ordem de prazo e mescla das cópias.
import {
  alertas, baseNova, caminhoPasta, concluidaEm, criarPasta, criarTarefa, descendentes, diasEntre, duracao, excluirEstado, excluirPasta, excluirTarefa,
  filhas, mesclar, moverPasta, mudarEstado, painel, tabelaCSV, validarBase, type Base,
  definirNota, definirNotaEtapa, adicionarEtapa, excluirEtapa, marcarEtapa, moverEtapa, progresso, estadoPelasEtapas, prazoEtapa, painelEtapas, alertasEtapas,
  passaDoPrazo, etapasForaDoPrazo, trazerEtapasAoPrazo, mudarPrazoTarefa, conflitoPrazos, resolverPrazos, maiorPrazoEtapas, ordenarEtapas, podeMoverEtapa,
} from "../src/tarefas/regras";

let falhas = 0;
function igual(nome: string, obtido: unknown, esperado: unknown) {
  const ok = typeof esperado === "number" && typeof obtido === "number" ? Math.abs(obtido - esperado) < 1e-6 : String(obtido) === String(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "ok  " : "FALHA"} ${nome}: ${String(obtido)}${ok ? "" : ` (esperado ${String(esperado)})`}`);
}
const T = (d: number, h = 0) => new Date(Date.UTC(2026, 9, d, h)).toISOString();

// --- pastas ---
const b = baseNova();
const obra = criarPasta(b, "Obra", null, T(1));
const projeto = criarPasta(b, "Projeto", obra.id, T(1));
const detalhe = criarPasta(b, "Detalhamento", projeto.id, T(1));
igual("raiz: Geral, Obra", filhas(b, null).map((p) => p.nome).join(), "Geral,Obra");
igual("caminho", caminhoPasta(b, detalhe.id), "Obra / Projeto / Detalhamento");
igual("descendentes de Obra", descendentes(b, obra.id).size, 3);
igual("não move para dentro de uma subpasta", moverPasta(b, obra.id, detalhe.id, 0, T(2)), false);
igual("move Detalhamento para a raiz, no topo", moverPasta(b, detalhe.id, null, 0, T(2)), true);
igual("ordem na raiz", filhas(b, null).map((p) => p.nome).join(), "Detalhamento,Geral,Obra");
moverPasta(b, detalhe.id, null, 9, T(2));
igual("move para o fim", filhas(b, null).map((p) => p.nome).join(), "Geral,Obra,Detalhamento");
moverPasta(b, detalhe.id, obra.id, 0, T(2));
igual("dentro de Obra, antes de Projeto", filhas(b, obra.id).map((p) => p.nome).join(), "Detalhamento,Projeto");

// --- tarefas e estados ---
const t1 = criarTarefa(b, projeto.id, "  Revisar desenho da base ", "2026-10-10", T(3, 8));
igual("título aparado", t1.titulo, "Revisar desenho da base");
igual("estado inicial", t1.estado, "novo");
igual("histórico com a criação", t1.historico.length, 1);
mudarEstado(t1, "execucao", T(4, 8));
mudarEstado(t1, "execucao", T(4, 9));
igual("mesmo estado não repete", t1.historico.length, 2);
mudarEstado(t1, "concluido", T(5, 20));
igual("concluída em", concluidaEm(b, t1), T(5, 20));
igual("duração", duracao(Date.parse(T(5, 20)) - Date.parse(T(3, 8))), "2 d 12 h");
b.estados.push({ id: "aprovado", nome: "Aprovado", cor: "#000", tipo: "fim", ordem: 3, atualizado: T(1) });
mudarEstado(t1, "aprovado", T(6));
igual("fim → fim não reinicia a conclusão", concluidaEm(b, t1), T(5, 20));
const t2 = criarTarefa(b, obra.id, "Comprar chapa", "2026-10-07", T(3));
const t3 = criarTarefa(b, "geral", "Sem prazo", null, T(3));
const t4 = criarTarefa(b, detalhe.id, "Atrasada", "2026-10-02", T(1));
mudarEstado(t4, "execucao", T(2));

// --- alertas e painel ---
igual("dias entre", diasEntre("2026-10-05", "2026-10-07"), 2);
igual("alertas com 2 dias", alertas(b, "2026-10-05", 2).map((a) => `${a.tarefa.titulo}:${a.dias}`).join(), "Atrasada:-3,Comprar chapa:2");
igual("alertas com 1 dia", alertas(b, "2026-10-05", 1).map((a) => a.tarefa.titulo).join(), "Atrasada");
igual("concluída não alerta", alertas(b, "2026-10-20", 0).some((a) => a.tarefa.id === t1.id), false);
const pn = painel(b, b.tarefas, new Date(T(7)));
igual("total", pn.total, 4);
igual("por estado novo", pn.porEstado.novo, 2);
igual("por estado execução", pn.porEstado.execucao, 1);
igual("por tipo fim", pn.porTipo.fim, 1);
igual("atrasadas no dia 7", pn.atrasadas, 1);
igual("atendimento médio", pn.atendimento!.media, Date.parse(T(5, 20)) - Date.parse(T(3, 8)));
igual("execução média", pn.execucao!.media, Date.parse(T(5, 20)) - Date.parse(T(4, 8)));
igual("concluídas em 7 dias", pn.concluidas7, 1);
igual("csv tem cabeçalho e 4 linhas", tabelaCSV(b).trim().split("\r\n").length, 5);
void t3;

// --- excluir estado e pasta ---
igual("não exclui o único início", excluirEstado(b, "novo", "execucao", T(8)), false);
igual("exclui estado e passa as tarefas", excluirEstado(b, "execucao", "novo", T(8)), true);
igual("tarefa voltou para novo", t4.estado, "novo");
const r = excluirPasta(b, obra.id, T(9));
igual("excluir Obra leva subpastas e tarefas", `${r.pastas}/${r.tarefas}`, "3/3");
igual("sobrou Geral", b.pastas.map((p) => p.nome).join(), "Geral");

// --- mescla das cópias ---
const a: Base = baseNova();
const p1 = criarPasta(a, "Casa", null, T(1));
const x = criarTarefa(a, p1.id, "Pintar", null, T(1));
const c: Base = validarBase(JSON.parse(JSON.stringify(a)));
// aparelho A muda o título depois; cópia C muda o estado antes → vale a de A (mais recente)
mudarEstado(c.tarefas[0], "execucao", T(2));
x.titulo = "Pintar a sala";
x.atualizado = T(3);
const y = criarTarefa(c, p1.id, "Lixar", null, T(2));
let m = mesclar([a, c], T(4));
igual("une tarefas novas das duas", m.tarefas.length, 2);
igual("mais recente vence", m.tarefas.find((t) => t.id === x.id)!.titulo, "Pintar a sala");
// exclusão em C depois da última alteração some com a tarefa nas duas
excluirTarefa(c, y.id, T(5));
m = mesclar([a, c, m], T(6));
igual("exclusão propaga", m.tarefas.some((t) => t.id === y.id), false);
// alteração posterior à exclusão traz de volta
const yv = { ...y, titulo: "Lixar (de novo)", atualizado: T(7) };
m = mesclar([{ ...a, tarefas: [...a.tarefas, yv] }, m], T(8));
igual("alterada depois da exclusão volta", m.tarefas.some((t) => t.id === y.id), true);
// exclusões vencidas (30 dias) são esquecidas
igual("exclusão antiga esquecida", mesclar([c], "2026-12-30T00:00:00.000Z").exclusoes.length, 0);
// pasta excluída em outra cópia: tarefas vão para a primeira pasta da raiz
const d = validarBase(JSON.parse(JSON.stringify(m)));
excluirPasta(d, p1.id, T(9));
const semPasta = { ...m, tarefas: [...m.tarefas, { ...x, id: "nova", atualizado: T(10) }] };
m = mesclar([semPasta, d], T(11));
igual("tarefa órfã vai para a raiz", m.tarefas.find((t) => t.id === "nova")!.pasta, "geral");
// movimentos cruzados (A dentro de B num aparelho, B dentro de A no outro) não criam ciclo
const e1 = baseNova();
const pa = criarPasta(e1, "A", null, T(1)), pb = criarPasta(e1, "B", null, T(1));
const e2 = validarBase(JSON.parse(JSON.stringify(e1)));
moverPasta(e1, pa.id, pb.id, 0, T(2));
moverPasta(e2, pb.id, pa.id, 0, T(3));
m = mesclar([e1, e2], T(4));
const semCiclo = m.pastas.every((p) => {
  const vistos = new Set<string>();
  for (let q: typeof p | undefined = p; q; q = m.pastas.find((z) => z.id === q!.pai)) {
    if (vistos.has(q.id)) return false;
    vistos.add(q.id);
  }
  return true;
});
igual("sem ciclo após movimentos cruzados", semCiclo, true);
igual("mescla não altera as entradas", e1.pastas.find((p) => p.id === pa.id)!.pai, pb.id);
// --- etapas (sub-tarefas) ---
const tb = baseNova();
const tt = criarTarefa(tb, "geral", "Fabricar suporte", null, T(1));
igual("tarefa nova sem etapas", tt.etapas === undefined, true);
igual("progresso sem etapas", JSON.stringify(progresso(tt)), '{"feitas":0,"total":0}');
igual("etapa vazia recusada", adicionarEtapa(tt, "   ", T(2)), null);
const et1 = adicionarEtapa(tt, " Cortar chapa ", T(2))!, et2 = adicionarEtapa(tt, "Dobrar", T(2))!, et3 = adicionarEtapa(tt, "Soldar", T(2))!;
igual("etapas na ordem", tt.etapas!.map((e) => e.titulo).join(), "Cortar chapa,Dobrar,Soldar");
marcarEtapa(tt, et1.id, true, T(3));
igual("etapa feita guarda a data", et1.feita, T(3));
igual("tarefa atualizada com a etapa", tt.atualizado, T(3));
marcarEtapa(tt, et1.id, true, T(4));
igual("marcar de novo não muda a data", et1.feita, T(3));
igual("progresso 1/3", JSON.stringify(progresso(tt)), '{"feitas":1,"total":3}');
moverEtapa(tt, et3.id, -1, T(5));
igual("subir etapa", tt.etapas!.map((e) => e.titulo).join(), "Cortar chapa,Soldar,Dobrar");
moverEtapa(tt, et1.id, -1, T(5));
igual("primeira não sobe", tt.etapas![0].id, et1.id);
excluirEtapa(tt, et2.id, T(6));
igual("excluir etapa", tt.etapas!.length, 2);
marcarEtapa(tt, et1.id, false, T(7));
igual("desmarcar", et1.feita, null);
igual("csv com etapas", tabelaCSV(tb).includes("0/2: Cortar chapa | Soldar"), true);
// arquivo antigo (sem etapas) continua igual; etapas inválidas são descartadas
const antiga = validarBase(JSON.parse(JSON.stringify({ ...baseNova(), tarefas: [{ ...tt, etapas: undefined }, { ...tt, id: "x", etapas: "lixo" }] })));
igual("tarefa antiga sem campo de etapas", "etapas" in antiga.tarefas[0], false);
igual("etapas inválidas descartadas", antiga.tarefas[1].etapas, undefined);
// sincronia: a alteração mais recente da tarefa leva a lista de etapas inteira
const outra = validarBase(JSON.parse(JSON.stringify(tb)));
adicionarEtapa(outra.tarefas[0], "Pintar", T(9));
igual("mescla leva a etapa nova", mesclar([tb, outra], T(10)).tarefas[0].etapas!.map((e) => e.titulo).join(), "Cortar chapa,Soldar,Pintar");

igual("etapa criada já com prazo", adicionarEtapa(tt, "Pintar", T(8), "2026-10-30")!.prazo, "2026-10-30");
igual("etapa criada sem prazo não tem o campo", "prazo" in adicionarEtapa(tt, "Embalar", T(8), null)!, false);

// --- observações (notas) ---
const nb = baseNova();
const tn = criarTarefa(nb, "geral", "Com nota", null, T(1));
definirNota(tn, "  Ligar para o fornecedor\nPedir NF  ", T(2));
igual("nota da tarefa aparada", JSON.stringify(tn.nota), JSON.stringify("Ligar para o fornecedor\nPedir NF"));
igual("nota atualiza a tarefa", tn.atualizado, T(2));
definirNota(tn, "Ligar para o fornecedor\nPedir NF", T(3));
igual("mesma nota não muda a data", tn.atualizado, T(2));
const en = adicionarEtapa(tn, "Cotar", T(4))!;
definirNotaEtapa(tn, en.id, "3 orçamentos", T(5));
igual("nota da etapa", en.nota, "3 orçamentos");
igual("csv com observação", tabelaCSV(nb).includes("[obs: 3 orçamentos]") && tabelaCSV(nb).includes("Pedir NF"), true);
definirNota(tn, "  ", T(6));
definirNotaEtapa(tn, en.id, "", T(6));
igual("nota vazia apaga os campos", "nota" in tn || "nota" in en, false);
const sem = criarTarefa(nb, "geral", "Sem nota", null, T(1));
igual("tarefa sem nota não tem o campo", "nota" in sem, false);

// --- conclusão automática pelas etapas ---
const ab = baseNova();
const ta = criarTarefa(ab, "geral", "Montar painel", null, T(1));
const a1 = adicionarEtapa(ta, "Furar", T(1))!, a2 = adicionarEtapa(ta, "Fixar", T(1))!;
marcarEtapa(ta, a1.id, true, T(2));
igual("primeira etapa feita passa para em execução", estadoPelasEtapas(ab, ta, T(2)) && ta.estado, "execucao");
igual("já em execução não muda de novo", estadoPelasEtapas(ab, ta, T(2)), false);
marcarEtapa(ta, a2.id, true, T(3));
igual("todas feitas concluem", estadoPelasEtapas(ab, ta, T(3)) && ta.estado, "concluido");
igual("data da conclusão = última etapa", concluidaEm(ab, ta), T(3));
marcarEtapa(ta, a2.id, false, T(4));
igual("desmarcar reabre em execução", estadoPelasEtapas(ab, ta, T(4)) && ta.estado, "execucao");
igual("tarefa sem etapas não muda", estadoPelasEtapas(ab, criarTarefa(ab, "geral", "Sem", null, T(1)), T(5)), false);

// --- prazos das etapas e análise ---
const qpb = baseNova();
const tp = criarTarefa(qpb, "geral", "Projeto", null, T(1));
const qp1 = adicionarEtapa(tp, "Esboço", T(1))!, qp2 = adicionarEtapa(tp, "Detalhar", T(1))!, qp3 = adicionarEtapa(tp, "Revisar", T(1))!, qp4 = adicionarEtapa(tp, "Liberar", T(1))!;
adicionarEtapa(tp, "Sem prazo", T(1));
prazoEtapa(tp, qp1.id, "2026-10-05", T(1));
prazoEtapa(tp, qp2.id, "2026-10-05", T(1));
prazoEtapa(tp, qp3.id, "2026-10-08", T(1));
prazoEtapa(tp, qp4.id, "2026-10-20", T(1));
igual("prazo gravado", qp3.prazo, "2026-10-08");
prazoEtapa(tp, qp4.id, "", T(1));
igual("prazo vazio tira o campo", "prazo" in qp4, false);
prazoEtapa(tp, qp4.id, "2026-10-20", T(1));
marcarEtapa(tp, qp1.id, true, T(3, 10)); // 2 dias antes
marcarEtapa(tp, qp2.id, true, T(8, 10)); // 3 dias depois
const pe = painelEtapas(qpb, qpb.tarefas, new Date(T(10, 12)));
igual("etapas total/feitas", `${pe.total}/${pe.feitas}/${pe.pendentes}`, "5/2/3");
igual("com prazo", pe.comPrazo, 4);
igual("no prazo / atraso", `${pe.noPrazo}/${pe.comAtraso}`, "1/1");
igual("% no prazo", pe.pctNoPrazo, 50);
igual("atraso médio", pe.atrasoMedio, 3);
igual("folga média", pe.folgaMedia, 2);
igual("pendentes atrasadas (Revisar)", pe.pendentesAtrasadas, 1);
igual("urgentes", pe.urgentes.map((u) => `${u.etapa.titulo}:${u.dias}`).join(), "Revisar:-2");
igual("alertas de etapa com 10 dias", alertasEtapas(qpb, "2026-10-10", 10).map((u) => u.etapa.titulo).join(), "Revisar,Liberar");
mudarEstado(tp, "concluido", T(11));
igual("tarefa concluída não alerta etapas", alertasEtapas(qpb, "2026-10-10", 10).length, 0);
igual("csv com prazo da etapa", tabelaCSV(qpb).includes("Revisar (prazo 2026-10-08)"), true);

// --- prazo da etapa ≤ prazo da tarefa (tarefa sem prazo = sem limite) ---
const ord = (t: { etapas?: { titulo: string }[] }) => t.etapas!.map((e) => e.titulo).join();
const rb = baseNova();
const rt = criarTarefa(rb, "geral", "Entregar projeto", "2026-10-20", T(1));
igual("etapa no prazo da tarefa entra", adicionarEtapa(rt, "Esboço", T(1), "2026-10-20")?.prazo, "2026-10-20");
igual("etapa nova depois do prazo: recusada", adicionarEtapa(rt, "Revisão", T(2), "2026-10-25"), null);
igual("recusa não mexe na tarefa", `${rt.prazo}|${rt.etapas!.length}|${rt.atualizado}`, `2026-10-20|1|${T(1)}`);
const rev = adicionarEtapa(rt, "Revisão", T(2), "2026-10-25", "estender")!;
igual("etapa nova + usar o maior prazo na tarefa", `${rt.prazo}|${rev.prazo}|${rt.atualizado}`, `2026-10-25|2026-10-25|${T(2)}`);
const rs = adicionarEtapa(rt, "Detalhar", T(2), "2026-10-10")!;
igual("editar etapa depois do prazo: recusada", prazoEtapa(rt, rs.id, "2026-11-01", T(3)), false);
igual("recusada: etapa e tarefa não mudam", `${rs.prazo}|${rt.prazo}|${rt.atualizado}`, `2026-10-10|2026-10-25|${T(2)}`);
igual("editar etapa + usar o maior prazo: aceita", prazoEtapa(rt, rs.id, "2026-11-01", T(3), "estender"), true);
igual("tarefa estendida até a etapa", `${rs.prazo}|${rt.prazo}|${rt.atualizado}`, `2026-11-01|2026-11-01|${T(3)}`);
igual("tirar o prazo da etapa sempre pode", prazoEtapa(rt, rs.id, "", T(3)), true);
igual("passa do prazo", `${passaDoPrazo(rt, "2026-11-02")}|${passaDoPrazo(rt, "2026-11-01")}|${passaDoPrazo(rt, null)}`, "true|false|false");
// antecipar o prazo da tarefa
prazoEtapa(rt, rs.id, "2026-10-28", T(3));
igual("antecipar: etapas afetadas (na ordem)", etapasForaDoPrazo(rt, "2026-10-22").map((e) => e.titulo).join(), "Revisão,Detalhar");
const af = mudarPrazoTarefa(rt, "2026-10-22", T(4));
igual("antecipar sem escolha: nada muda", `${af.length}|${rt.prazo}|${rev.prazo}|${rs.prazo}|${rt.atualizado}`, `2|2026-11-01|2026-10-25|2026-10-28|${T(3)}`);
mudarPrazoTarefa(rt, "2026-10-22", T(4), "trazer");
igual("antecipar trazendo as etapas", `${rt.prazo}|${rev.prazo}|${rs.prazo}|${rt.etapas![0].prazo}`, "2026-10-22|2026-10-22|2026-10-22|2026-10-20");
igual("antecipar com etapas afetadas: recusa", `${mudarPrazoTarefa(rt, "2026-10-21", T(5)).length}|${rt.prazo}`, "2|2026-10-22");
mudarPrazoTarefa(rt, "2026-10-30", T(5));
igual("antecipar sem etapas afetadas: muda direto", `${mudarPrazoTarefa(rt, "2026-10-25", T(5)).length}|${rt.prazo}|${rev.prazo}`, "0|2026-10-25|2026-10-22");
igual("depois de trazer, nenhuma fora do prazo", etapasForaDoPrazo(rt).length, 0);
// tarefa sem prazo
const rl = criarTarefa(rb, "geral", "Sem prazo", null, T(1));
igual("tarefa sem prazo: etapa sem limite", adicionarEtapa(rl, "Longe", T(1), "2030-01-01")?.prazo, "2030-01-01");
igual("tarefa sem prazo: editar sem limite", prazoEtapa(rl, rl.etapas![0].id, "2031-01-01", T(1)), true);
igual("tarefa sem prazo: nada fora do prazo", etapasForaDoPrazo(rl).length, 0);
igual("tirar o prazo da tarefa: nenhuma afetada", mudarPrazoTarefa(rt, null, T(7)).length + String(rt.prazo), "0null");
igual("dar prazo antes das etapas: avisa", mudarPrazoTarefa(rl, "2026-12-01", T(7)).map((e) => e.titulo).join() + `|${rl.prazo}`, "Longe|null");

// --- alerta de mão dupla: trazer as etapas / usar o maior prazo entre as etapas / cancelar ---
// várias etapas com prazo numa tarefa sem prazo; depois a tarefa ganha um prazo antes de algumas
const mk = () => {
  const x = criarTarefa(baseNova(), "geral", "Montar bancada", null, T(1));
  for (const [n, d] of [["Comprar perfis", "2026-10-05"], ["Cortar", "2026-10-12"], ["Soldar", "2026-10-20"], ["Pintar", "2026-10-15"], ["Montar", null]] as const) adicionarEtapa(x, n, T(1), d);
  return x;
};
const m0 = mk();
const cf = conflitoPrazos(m0, { tarefa: "2026-10-10" })!;
igual("conflito lista as afetadas (na ordem)", cf.afetadas.map((e) => `${e.titulo}:${e.prazo}`).join(), "Cortar:2026-10-12,Pintar:2026-10-15,Soldar:2026-10-20");
igual("conflito: prazo da tarefa e maior prazo entre as etapas", `${cf.prazoTarefa}|${cf.maior}`, "2026-10-10|2026-10-20");
igual("maior prazo entre várias etapas", maiorPrazoEtapas(m0), "2026-10-20");
igual("conflito não muda nada", `${m0.prazo}|${m0.atualizado}`, `null|${T(1)}`);
igual("sem conflito: null", conflitoPrazos(m0, { tarefa: "2026-10-25" }), null);
igual("tirar o prazo: sem conflito", conflitoPrazos(m0, { tarefa: null }), null);
// opção 1: trazer as etapas para o prazo da tarefa
const m1 = mk();
mudarPrazoTarefa(m1, "2026-10-10", T(2), "trazer");
igual("trazer: tarefa com o prazo pedido", m1.prazo, "2026-10-10");
igual("trazer: etapas no prazo da tarefa, na ordem", m1.etapas!.map((e) => `${e.titulo}:${e.prazo ?? "-"}`).join(), "Comprar perfis:2026-10-05,Cortar:2026-10-10,Pintar:2026-10-10,Soldar:2026-10-10,Montar:-");
igual("trazer: atualiza a tarefa", m1.atualizado, T(2));
// opção 2: usar na tarefa o maior prazo entre as etapas
const m2 = mk();
mudarPrazoTarefa(m2, "2026-10-10", T(2), "estender");
igual("usar o maior prazo: tarefa = maior prazo entre as etapas", `${m2.prazo}|${etapasForaDoPrazo(m2).length}`, "2026-10-20|0");
igual("usar o maior prazo: etapas não mudam", m2.etapas!.map((e) => e.prazo ?? "-").join(), "2026-10-05,2026-10-12,2026-10-15,2026-10-20,-");
// opção 3: cancelar = não chamar com escolha (nada muda)
const m3 = mk();
igual("cancelar: nada muda", `${mudarPrazoTarefa(m3, "2026-10-10", T(2)).length}|${m3.prazo}|${m3.atualizado}`, `3|null|${T(1)}`);
// o mesmo conflito pelo lado da etapa
const m4 = mk();
mudarPrazoTarefa(m4, "2026-10-25", T(2));
const pin = m4.etapas!.find((e) => e.titulo === "Pintar")!;
const c4 = conflitoPrazos(m4, { etapa: { id: pin.id, prazo: "2026-10-30" } })!;
igual("conflito pela etapa: afetada já com a nova data", `${c4.afetadas.map((e) => `${e.titulo}:${e.prazo}`).join()}|${c4.maior}|${pin.prazo}`, "Pintar:2026-10-30|2026-10-30|2026-10-15");
igual("conflito por etapa nova", conflitoPrazos(m4, { etapa: { id: null, prazo: "2026-11-02", titulo: "Entregar" } })!.afetadas.map((e) => e.titulo).join(), "Entregar");
prazoEtapa(m4, pin.id, "2026-10-30", T(3), "trazer");
igual("etapa + trazer: a etapa fica no prazo da tarefa (no fim do grupo da data)", `${pin.prazo}|${m4.prazo}|${ord(m4)}`, "2026-10-25|2026-10-25|Comprar perfis,Cortar,Soldar,Pintar,Montar");
const m5 = mk();
mudarPrazoTarefa(m5, "2026-10-25", T(2));
adicionarEtapa(m5, "Entregar", T(3), "2026-11-02", "trazer");
igual("etapa nova + trazer: entra no prazo da tarefa", `${m5.etapas!.find((e) => e.titulo === "Entregar")!.prazo}|${m5.prazo}`, "2026-10-25|2026-10-25");
adicionarEtapa(m5, "Documentar", T(3), "2026-11-05", "estender");
igual("etapa nova + usar o maior prazo", `${m5.prazo}|${ord(m5)}`, "2026-11-05|Comprar perfis,Cortar,Pintar,Soldar,Entregar,Documentar,Montar");

// --- ordem automática das etapas por prazo ---
const o = criarTarefa(baseNova(), "geral", "Ordem", null, T(1));
const oA = adicionarEtapa(o, "A", T(1), "2026-10-10")!, oB = adicionarEtapa(o, "B", T(1), null)!, oC = adicionarEtapa(o, "C", T(1), "2026-10-05")!;
const oD = adicionarEtapa(o, "D", T(1), "2026-10-10")!, oE = adicionarEtapa(o, "E", T(1), null)!;
igual("criar já ordena (sem prazo no fim, empate na ordem de criação)", ord(o), "C,A,D,B,E");
moverEtapa(o, oD.id, -1, T(2));
igual("subir dentro da mesma data", ord(o), "C,D,A,B,E");
igual("não sobe para outra data", `${podeMoverEtapa(o, oD.id, -1)}|${moverEtapa(o, oD.id, -1, T(3))}|${ord(o)}|${o.atualizado}`, `false|false|C,D,A,B,E|${T(2)}`);
igual("primeira sem prazo não sobe para a última com prazo", podeMoverEtapa(o, oB.id, -1), false);
moverEtapa(o, oE.id, -1, T(3));
igual("ordem manual entre as sem prazo", ord(o), "C,D,A,E,B");
igual("descer dentro da mesma data", `${moverEtapa(o, oD.id, 1, T(4))}|${ord(o)}`, "true|C,A,D,E,B");
prazoEtapa(o, oB.id, "2026-10-01", T(5));
igual("dar prazo reposiciona", ord(o), "B,C,A,D,E");
prazoEtapa(o, oC.id, "2026-10-10", T(5));
igual("mudar a data vai para o fim do grupo da nova data", ord(o), "B,A,D,C,E");
prazoEtapa(o, oA.id, "", T(6));
igual("tirar o prazo: vai para o fim (depois das sem prazo)", ord(o), "B,D,C,E,A");
marcarEtapa(o, oD.id, true, T(7));
igual("etapa feita não sai do lugar", ord(o), "B,D,C,E,A");
igual("ordenar lista já em ordem: nada muda", ordenarEtapas(o), false);
// sincronia entre aparelhos mantendo a ordem
const so = baseNova();
const st = criarTarefa(so, "geral", "Sincronia", null, T(1));
const s1 = adicionarEtapa(st, "Um", T(1), "2026-10-10")!, s2 = adicionarEtapa(st, "Dois", T(1), "2026-10-10")!;
adicionarEtapa(st, "Três", T(1), "2026-10-03");
const outroAp = validarBase(JSON.parse(JSON.stringify(so)));
moverEtapa(outroAp.tarefas[0], s2.id, -1, T(4)); // outro aparelho troca a ordem manual depois
const sm = mesclar([so, outroAp], T(5));
igual("sincronia: ordem manual do aparelho mais recente", ord(sm.tarefas[0]), "Três,Dois,Um");
prazoEtapa(st, s1.id, "2026-10-01", T(6)); // este aparelho muda uma data por último
igual("sincronia: data nova reposiciona nos dois", ord(mesclar([outroAp, so], T(7)).tarefas[0]), "Um,Três,Dois");
const velha = validarBase(JSON.parse(JSON.stringify({ ...baseNova(), tarefas: [{ ...st, etapas: [{ id: "x", titulo: "Sem", feita: null }, { id: "y", titulo: "Tarde", feita: null, prazo: "2026-12-01" }, { id: "z", titulo: "Cedo", feita: null, prazo: "2026-10-01" }] }] })));
igual("arquivo antigo fora de ordem: ordenado ao ler", ord(velha.tarefas[0]), "Cedo,Tarde,Sem");
igual("ordenar ao ler não muda a data de alteração", velha.tarefas[0].atualizado, st.atualizado);
igual("mescla de lista fora de ordem: ordenada", ord(mesclar([{ ...baseNova(), tarefas: [{ ...st, etapas: [{ id: "x", titulo: "Sem", feita: null }, { id: "z", titulo: "Cedo", feita: null, prazo: "2026-10-01" }] }] }], T(8)).tarefas[0]), "Cedo,Sem");

// dado inconsistente vindo da sincronia (ou antigo): mescla não corrige sozinha; o selo oferece as 3 opções
const dx = baseNova();
const tx = criarTarefa(dx, "geral", "Vinda do outro aparelho", "2026-10-10", T(1));
tx.etapas = [{ id: "e1", titulo: "Ok", feita: null, prazo: "2026-10-09" }, { id: "e2", titulo: "Passa", feita: null, prazo: "2026-10-15" }, { id: "e3", titulo: "Também", feita: T(2), prazo: "2026-10-12" }];
const daSinc = () => mesclar([baseNova(), validarBase(JSON.parse(JSON.stringify(dx)))], T(9)).tarefas.find((x) => x.id === tx.id)!;
const ty = daSinc();
igual("sincronia não altera os prazos errados", ty.etapas!.map((e) => `${e.id}:${e.prazo}`).join(), "e1:2026-10-09,e3:2026-10-12,e2:2026-10-15");
igual("sincronia: etapas marcadas", etapasForaDoPrazo(ty).map((e) => e.id).join(), "e3,e2");
const cs = conflitoPrazos(ty)!;
igual("selo: conflito do dado como está", `${cs.afetadas.map((e) => e.id).join()}|${cs.prazoTarefa}|${cs.maior}`, "e3,e2|2026-10-10|2026-10-15");
const antesSinc = ty.atualizado;
igual("selo + trazer", `${resolverPrazos(ty, "trazer", T(10))}|${ty.etapas!.map((e) => e.prazo).join()}|${ty.prazo}`, "2|2026-10-09,2026-10-10,2026-10-10|2026-10-10");
igual("corrigir atualiza a tarefa (vai pela sincronia)", ty.atualizado !== antesSinc, true);
const tz = daSinc();
igual("selo + usar o maior prazo", `${resolverPrazos(tz, "estender", T(10))}|${tz.prazo}|${etapasForaDoPrazo(tz).length}`, "1|2026-10-15|0");
igual("nada a resolver: tarefa não muda", `${resolverPrazos(tz, "trazer", T(12))}|${tz.atualizado}`, `0|${T(10)}`);
igual("trazer só a etapa tocada", `${trazerEtapasAoPrazo(daSinc(), T(10), ["e2"])}`, "1");

let erro = "";
try {
  validarBase({ formato: "outro" });
} catch (z) {
  erro = (z as Error).message;
}
igual("arquivo inválido recusado", /inválido/.test(erro), true);

if (falhas) {
  console.error(`\n${falhas} falha(s) nas regras do WJTaskPlan`);
  process.exit(1);
}
console.log("\nWJTaskPlan: regras ok");
