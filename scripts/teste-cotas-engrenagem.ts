// Teste das cotas de diâmetro da engrenagem (src/biblioteca/cotasEngrenagem.ts + caixas de painelEngrenagens.ts)
// em Node: valores = fórmulas da norma e = linhas "Valores calculados" do painel, posição da linha de cota
// (pontas sobre a circunferência, centro no eixo Y, plano da face), tipos sem diâmetro (cremalheira), diâmetro
// interno só na interna, entrada inválida sem cota, e as caixas guardadas nas preferências (padrão: nenhuma).
import { cotasDiametro, cotasDisponiveis, diametrosDaEngrenagem, textoDiametro, type TipoCotaEng } from "../src/biblioteca/cotasEngrenagem";
import { paramCompleto, valoresCalculados } from "../src/biblioteca/engrenagens";
import type { ParamEngrenagem } from "../src/model";

// armazenamento de mentira (o teste roda em Node)
const memoria = new Map<string, string>();
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => memoria.get(k) ?? null,
  setItem: (k: string, v: string) => void memoria.set(k, v),
} as Storage;
const { cotasDasPrefs, cotasMarcadas } = await import("../src/biblioteca/painelEngrenagens");
const { gravarPrefsCad } = await import("../src/ui/preferenciasCad");

let falhas = 0;
function verdade(nome: string, v: boolean, extra = "") {
  if (!v) falhas++;
  console.log(`${v ? "ok  " : "FALHA"} ${nome}${extra ? ` ${extra}` : ""}`);
}
function confere(nome: string, obtido: number | undefined, esperado: number, tol = 1e-6) {
  const ok = obtido !== undefined && Math.abs(obtido - esperado) <= tol * Math.max(1, Math.abs(esperado));
  if (!ok) falhas++;
  console.log(`${ok ? "ok  " : "FALHA"} ${nome}: ${obtido?.toFixed(5)} (esperado ${esperado.toFixed(5)})`);
}
const P = (p: Partial<ParamEngrenagem>) => paramCompleto(p);
const TODAS: TipoCotaEng[] = ["externo", "primitivo", "interno"];
const dist = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
/** Valor da linha do painel ("62 mm" → texto "Ø62"). */
const linhaPainel = (p: Partial<ParamEngrenagem>, parte: RegExp) => {
  const v = valoresCalculados(p).valores.find((x) => parte.test(x.rotulo));
  return v ? `Ø${v.valor.replace(" mm", "")}` : undefined;
};

// 1) reta m2 z20: da = m(z+2) = 44, d = 40
{
  const p = P({ tipoEngrenagem: "reta", modulo: 2, dentes: 20, largura: 15 });
  const { valores, y } = diametrosDaEngrenagem(p);
  confere("reta Ø externo", valores.externo, 44);
  confere("reta Ø primitivo", valores.primitivo, 40);
  verdade("reta sem Ø interno", valores.interno === undefined);
  confere("reta: linha no plano da face de trás (y = largura)", y, 15);
  const cs = cotasDiametro(p, ["externo", "primitivo"]);
  verdade("2 cotas", cs.length === 2);
  const [ext, pri] = cs;
  verdade("texto Ø44 / Ø40", ext.texto === "Ø44" && pri.texto === "Ø40", `(${ext.texto}, ${pri.texto})`);
  confere("pontas a distância = diâmetro (externo)", dist(ext.a, ext.b), 44);
  confere("pontas a distância = diâmetro (primitivo)", dist(pri.a, pri.b), 40);
  verdade("linha passa pelo centro no eixo Y", ext.centro[0] === 0 && ext.centro[1] === 15 && ext.centro[2] === 0 && Math.abs(ext.a[0] + ext.b[0]) < 1e-9 && Math.abs(ext.a[2] + ext.b[2]) < 1e-9);
  confere("externo ao longo de +X (dente 0)", ext.a[0], 22);
  verdade("primitivo em outra direção (não encavala o externo)", Math.abs(ext.dir[0] * pri.dir[0] + ext.dir[2] * pri.dir[2]) < 1e-9);
  verdade("valor entre o centro e a ponta, sobre a linha", Math.abs(ext.pos[0] - 11) < 1e-9 && ext.pos[1] === 15 && Math.abs(pri.pos[2] - 10) < 1e-9);
  verdade("primitivo tracejado, externo contínuo", pri.tracejada && !ext.tracejada);
  verdade("batem com 'Valores calculados' do painel", ext.texto === linhaPainel(p, /Diâmetro externo da$/) && pri.texto === linhaPainel(p, /Diâmetro primitivo d$/));
  verdade("só as marcadas aparecem", cotasDiametro(p, ["primitivo"]).length === 1 && cotasDiametro(p, []).length === 0);
  verdade("pedir 'interno' numa reta não cria cota", cotasDiametro(p, ["interno"]).length === 0);
}

// 2) deslocamento de perfil: da = d + 2m(1 + x)
{
  const p = P({ tipoEngrenagem: "reta", modulo: 2, dentes: 20, deslocamento: 0.3 });
  confere("Ø externo com x = 0,3", diametrosDaEngrenagem(p).valores.externo, 40 + 2 * 2 * 1.3);
  confere("Ø primitivo não muda com x", diametrosDaEngrenagem(p).valores.primitivo, 40);
}

// 3) helicoidal: d = z·mn/cos β
{
  const p = P({ tipoEngrenagem: "helicoidal", modulo: 2, dentes: 20, helice: 15, largura: 20 });
  const d = (20 * 2) / Math.cos((15 * Math.PI) / 180);
  confere("helicoidal Ø primitivo", diametrosDaEngrenagem(p).valores.primitivo, d);
  confere("helicoidal Ø externo", diametrosDaEngrenagem(p).valores.externo, d + 4);
  const cs = cotasDiametro(p, TODAS);
  verdade("helicoidal: externo e primitivo (sem interno)", cs.map((c) => c.tipo).join() === "externo,primitivo");
  verdade("helicoidal bate com o painel", cs[0].texto === linhaPainel(p, /Diâmetro externo da$/) && cs[1].texto === linhaPainel(p, /Diâmetro primitivo d$/));
}

// 4) interna: externo = aro, primitivo = d, interno = ponta (da, dentro)
{
  const p = P({ tipoEngrenagem: "interna", modulo: 2, dentes: 60, largura: 12 });
  const v = diametrosDaEngrenagem(p).valores;
  confere("interna Ø primitivo", v.primitivo, 120);
  confere("interna Ø interno (ponta)", v.interno, 116);
  confere("interna Ø externo = aro automático (df + 6m)", v.externo, 2 * (62.5 + 6));
  const cs = cotasDiametro(p, TODAS);
  verdade("interna: 3 cotas com direções diferentes", cs.length === 3 && new Set(cs.map((c) => c.dir.join())).size === 3);
  verdade("interna: texto do interno bate com o painel", cs[2].texto === linhaPainel(p, /Diâmetro da ponta \(interno\) da$/));
  verdade("interna: externo bate com o painel", cs[0].texto === linhaPainel(p, /Diâmetro externo do aro$/));
  confere("aro informado (Ø150)", diametrosDaEngrenagem(P({ ...p, aro: 150 })).valores.externo, 150);
  verdade("interna oferece as 3 caixas", cotasDisponiveis("interna").join() === "externo,primitivo,interno");
}

// 5) sem-fim e coroa
{
  const sf = P({ tipoEngrenagem: "semFim", modulo: 2, dentes: 1, coefDiametro: 10, largura: 40 });
  confere("sem-fim Ø primitivo d1 = q·m", diametrosDaEngrenagem(sf).valores.primitivo, 20);
  confere("sem-fim Ø externo da1 = d1 + 2m", diametrosDaEngrenagem(sf).valores.externo, 24);
  const co = P({ tipoEngrenagem: "coroa", modulo: 2, dentes: 40, entradas: 1, coefDiametro: 10, largura: 14 });
  confere("coroa Ø primitivo", diametrosDaEngrenagem(co).valores.primitivo, 80);
  confere("coroa Ø externo", diametrosDaEngrenagem(co).valores.externo, 84);
}

// 6) cônica: externo = o da face maior plana do modelo (y = 0), primitivo = d
{
  const p = P({ tipoEngrenagem: "conica", modulo: 3, dentes: 20, dentesPar: 40, anguloEixos: 90, largura: 10 });
  const { valores, y } = diametrosDaEngrenagem(p);
  confere("cônica Ø primitivo", valores.primitivo, 60);
  confere("cônica: linha na face maior (y = 0)", y, 0);
  verdade("cônica Ø externo = 'face maior plana' do painel", textoDiametro(valores.externo!) === linhaPainel(p, /face maior plana/));
  verdade("cônica Ø externo maior que o primitivo", valores.externo! > 60);
}

// 7) cremalheira não tem diâmetro: nada a mostrar e as caixas somem
{
  const p = P({ tipoEngrenagem: "cremalheira", modulo: 2, comprimento: 100, altura: 12 });
  verdade("cremalheira: sem diâmetros", Object.keys(diametrosDaEngrenagem(p).valores).length === 0 && cotasDiametro(p, TODAS).length === 0);
  verdade("cremalheira: nenhuma caixa", cotasDisponiveis("cremalheira").length === 0);
  verdade("reta oferece 2 caixas (externo, primitivo)", cotasDisponiveis("reta").join() === "externo,primitivo");
}

// 8) entrada impossível não derruba (o painel já mostra o erro em vermelho)
verdade("entrada inválida: sem cotas", cotasDiametro(P({ tipoEngrenagem: "reta", dentes: 2 }), TODAS).length === 0 && cotasDiametro(P({ modulo: 0 }), TODAS).length === 0);

// 9) formato do valor
verdade("texto: 3 casas, vírgula decimal", textoDiametro(41.41103) === "Ø41,411" && textoDiametro(44) === "Ø44");

// 10) preferências do usuário: padrão desmarcadas; guardadas; filtradas pelo tipo
{
  verdade("padrão: nenhuma caixa marcada", cotasDasPrefs().length === 0 && cotasMarcadas("reta").length === 0);
  gravarPrefsCad({ engCotas: ["primitivo", "interno"], dispositivo: "tablet" });
  verdade("guarda as marcadas (sem apagar outras preferências)", cotasDasPrefs().join() === "primitivo,interno" && JSON.parse(memoria.get("jlscad:interface")!).dispositivo === "tablet");
  verdade("reta ignora o 'interno' marcado", cotasMarcadas("reta").join() === "primitivo");
  verdade("interna mostra as duas", cotasMarcadas("interna").join() === "primitivo,interno");
  verdade("cremalheira: nenhuma", cotasMarcadas("cremalheira").length === 0);
  gravarPrefsCad({ engCotas: [] });
  verdade("desmarcar tudo volta a nenhuma", cotasDasPrefs().length === 0);
}

console.log(falhas ? `\n${falhas} FALHA(S)` : "\nTudo certo.");
if (falhas) process.exit(1);
