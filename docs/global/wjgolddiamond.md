# WJGoldDiamond — modelagem 3D de joias

Face do WJProMaster pedida pelo Johann em 07/11/2026: CAD **especializado em joias**, no tablet,
celular e computador. Página `joia/`, código em `src/joia/`, arquivo `.wjgd` no cofre do WJPDM (pasta
padrão **Joias**), motor e geometria testados em Node (`scripts/teste-joia.ts`, dentro do `pnpm teste`).

Inspiração funcional (nunca nomes, ícones ou textos na interface): CADs de joalheria profissionais
(construtores paramétricos com histórico, abordagem "gema primeiro", gemas em curva, pavé
automático, peso por liga, relatórios de pedras, canais de fundição) e configuradores de anéis na web.

## 1. Arquitetura

Reaproveita o que já existe, sem duplicar:

- **Kernel**: o mesmo OpenCascade (`replicad`) do WJCAD, num worker próprio (`src/joia/worker.ts`).
  O `.wasm` é o mesmo arquivo do WJCAD (cache único, offline).
- **Casca, cofre, GO-OUT/GO-IN, desfazer, salvamento automático** (`wjgd:documento`): `src/comum/`.
- **Texto da gravação**: fonte e contornos do texto de esboço do WJCAD (`src/esboco/fontesTexto.ts`, `texto.ts`).
- **Modelo paramétrico próprio** (`DocJoia` em `src/joia/regras.ts`): construtores com parâmetros,
  não uma árvore de esboços. Mudar o tamanho do aro, a gema ou o perfil reconstrói tudo.

| Arquivo | Papel |
|---|---|
| `src/joia/regras.ts` | motor puro: tamanhos de aro, ligas, lapidações (contorno, proporções, quilates), perfil, posição de gemas/garras/contas/trilhos, zonas livres, facetas, verificações, ficha e preço |
| `src/joia/geometria.ts` | sólido no OpenCascade: aro (inteiro, dividido, ramos afastados), cabeça, cápsulas das garras livres, assentos, gravação, texturas, ocar, fabricação |
| `src/joia/gemasLivres.ts` | gemas livres (J9a): lugar e orientação, garras (bolinha/alongada/dupla, V nas pontas), apoio mais próximo, simetria, colisões |
| `src/joia/modelos.ts` | modelos prontos montados só com construtores ("Anel folhas com oval") |
| `src/joia/malhaGema.ts` | malha facetada das gemas para a vista (sem kernel) |
| `src/joia/vista.ts` | Three.js: metal com reflexos do ambiente, gemas com refração e dispersão, ortográfica |
| `src/joia/main.ts` | interface: construtores, painel, janelas (biblioteca, ficha, modelos) |

**Coordenadas**: eixo do aro = Z, topo do anel em +Y, θ medido de +Y para +X (Frente = vista do
círculo do aro, como no WJCAD com Y para cima).

**Desempenho** (lições do WJCAD aplicadas e novas):
- Booleanas com **várias ferramentas de uma vez** pela API do OpenCascade (`BRepAlgoAPI_*` com
  `SetArguments/SetTools`, tolerância difusa 1e-5), sem compostos e sem a simplificação do replicad
  (que quebrava sólidos). Cada booleana é **conferida pelo volume** (`segura`): se o lote falhar,
  refaz uma por vez e avisa o que ficou de fora; nunca mostra sólido quebrado.
- Aro afunilado **analítico** (revolução num eixo excêntrico + dois planos laterais + furo
  concêntrico): só toros, cilindros e planos, 4× mais rápido que loft. Loft só com torção.
- Contas do pavé = esferas (4× mais rápido que cilindro + esfera); lapidações curvas com contorno
  em spline (poucas faces); letras com pontos quase alinhados removidos.
- O worker manda **prévia** (aro + cabeça) e depois a joia completa; só o último pedido é atendido.
  As gemas aparecem na hora (posições calculadas na interface, sem kernel).

## 2. Construtores (J0–J6)

| Fase | Entrega | Estado |
|---|---|---|
| **J0** | Página, caixa no início, abas Joia / Gemas / Fabricação / Vista, `.wjgd` no cofre (pasta Joias), tabela de ligas e peso em gramas | ✅ 07/11/2026 |
| **J1** | **Aro por tamanho** (Brasil ≈ circunferência − 40 mm, ISO 8653, EUA, diâmetro direto); perfis anatômico, meia-cana, reto e faca; largura/espessura no topo e na base (afunilado); **gravação** interna | ✅ |
| **J2** | **Biblioteca de gemas**: 10 lapidações (redonda, oval, gota, navete, princesa, esmeralda, coração, almofada, baguete, trilliant), 9 materiais, proporções padrão, peso em quilates (fórmulas de mercado × densidade), mm ↔ ct, material de diamante com refração e dispersão | ✅ |
| **J3** | **Cabeça "gema primeiro"**: garras (2–8, Ø, cesta convergindo no aro, galeria), inglesa (parede, abertura de luz), altura da cintura, girar a gema; assento automático (furo de luz, pavilhão, cintura, passagem pela coroa) | ✅ |
| **J4** | **Pavé**: gemas em curva ao longo do aro com tamanhos graduados, arco, espaço, 1–5 fileiras, eternidade (volta inteira), contas automáticas entre pedras ou trilho (canal); colisão e encaixe lateral (posições que não cabem saem com aviso); todos os assentos num corte só | ✅ |
| **J5** | **Fabricação**: ocar (canal interno nas zonas livres, parede mínima), contração da fundição, canais de alimentação, STL para impressão/fundição, STL e STEP limpos, **ficha técnica** (pedras por tipo, quilates, peso do metal com perda, peso da resina, CSV), verificações (espessuras e garras mínimas por liga, profundidade da gravação, micropavé), **preço** (R$/g, R$/ct, mão de obra, margem) | ✅ |
| **J6** | **Torção** (meias-voltas; perfis assimétricos só em voltas inteiras), **afunilado**, **gravação externa** (envolve o aro), texturas **facetado** e **frisos** fora das zonas ocupadas; vistas, girar (apresentação) e imagem PNG | ✅ |
| **J7** | **Modelagem livre**: ornamentos desenhados com o **esboço do WJCAD** (linha, arco, spline, círculo, elipse, ponto, espelhar, offset, cotas e relações) na vista de cima do aro, com **prévia espelhada**; cada entidade vira **fio** de perfil redondo (Ø inicial/final e altura inicial/final por fio: o fio sobe da moldura até o aro), simetria nos dois eixos, envolvido no aro ou num plano sobre o topo, bolinha nas pontas soltas; cada **ponto** vira bolinha de metal ou **pedrinha em inglesa** (entra na ficha e no peso em ct). **Ponta da garra**: bolinha, alongada (sobre a pedra) ou garra dupla. **Aro dividido** (abertura no topo e até que ângulo). Exemplo pronto: "Anel vintage com filigrana" (moldura em pipa, volutas, pontas norte–sul, pedrinhas laterais). Correção: o furo de luz da gema central parava no aro e cortava o aro inteiro com gemas largas; agora para no topo do aro e há aviso quando a culaça entra no aro | ✅ 08/11/2026 |
| **J8** | **Escultura livre em malha**: corpos esculpidos postos na joia (posição ao longo do aro, lateral, altura, tamanho, giros, cópia espelhada do outro lado), partindo de esfera, gota, folha ou cápsula; pincéis **Puxar, Inflar, Suavizar, Achatar, Vinco e Arrastar** com raio, força, **pressão da caneta**, inverter e simetria; subdividir até 40 962 vértices; desfazer por traço. **Caneta ou mouse esquerdo esculpe; dedo (ou botão do meio) gira**, dois dedos aproximam ("Dedo esculpe" para quem não tem caneta). Peso, área e **STL numa peça só** pela união de malhas (`manifold-3d`); STEP leva só a parte paramétrica | ✅ 08/11/2026 |
| **J9a** | **Gemas livres**: qualquer lapidação num ponto livre (θ ao longo do aro, lateral, altura da cintura sobre o aro ou relativa à cintura da central), giro no plano, inclinação e "seguir a superfície"; engaste próprio (garras com ponta bolinha/alongada/dupla, **garras em V nas pontas** da navete/gota/coração + laterais opcionais, ou inglesa); hastes até o **apoio mais próximo** (aro, ramo do aro dividido, fio de ornamento, garra da central; > 1,5 mm = aviso); simetria por gema (cópias na ficha); duplicar; **posicionar tocando na vista** (caneta, dedo ou mouse) e tocar numa gema para selecioná-la; assentos no mesmo corte em lote; avisos de colisão (gema × gema, gema × garra da central), gema fora do metal/enterrada e garra abaixo do mínimo. **Aro dividido com afastamento dos ramos** (abrem ao longo do dedo até a cabeça). Modelo **"Anel folhas com oval"** (ANEL AMOR) | ✅ 21/11/2026 |
| J9b | Referência por foto, fios avançados, folhas paramétricas e concordância (troca as folhinhas do J9a) | próximo |
| J10 | Remalha dinâmica (densidade automática sob o pincel), esculpir a joia inteira convertida em malha, relevo por imagem, texturas martelado/acetinado, gemas inclinadas pela normal em perfis curvos, pavé em superfície livre, halo, outras peças (brinco, pingente), perfil do fio (meia-cana, quadrado), vídeo giratório pelo WJVideoMaker, preço/itens no WJERP | próximo |

Modelos prontos (aba Joia → Modelos): solitário, solitário com pavé, aliança com gravação,
meia-aliança, eternidade, inglesa oval, anel torcido, **anel vintage com filigrana**, **anel folhas com oval**, aliança facetada.

### Modelo "Anel folhas com oval" (J9a, a partir da descrição da foto do ANEL AMOR)
- Aro BR 10 (circunferência 50 mm, Ø 15,92 mm), perfil reto 1,80 × 1,45 mm, ouro 750 amarelo; dividido (vão 0,6 mm,
  até 32°) com **ramos afastados 1,7 mm** no topo: a culaça da oval (cintura 1,35 mm acima do aro) passa entre os ramos.
- Central: oval 8 × 6 rubi, eixo longo ao longo do dedo (girar 90°), 4 garras Ø 0,92, galeria.
- Ao longo do dedo: redonda 2,4 numa ponta e 2,0 na outra (folga 0,3 mm da oval), 4 garras Ø 0,6 cada.
- Leques: **a navete 2,5 × 1,25 fica no meio de cada leque (0°, transversal)**; as 2,0 × 1,0 a ±50° (uma gema
  livre com simetria nos dois eixos = 4 navetes); cintura 0,4 mm abaixo da central, inclinadas 10–12°, garras em V.
- Ornamento "Ramos e gavinhas" (simetria nos dois eixos): moldura sob as gemas, ramo que sobe do ombro e gavinha onde
  o aro se divide (fios Ø 0,6–0,9). Folhinhas: escultura "folha" engrossada (≥ 0,5 mm no centro) entre as navetes e
  nos ombros, com cópia do outro lado (o J9b troca por folhas paramétricas).
- Resultado (Node): 9 gemas, 1,397 ct; metal paramétrico 189,5 mm³, com as folhinhas 191,7 mm³ = **2,97 g** em ouro
  750 (v1 em Python: 182 mm³ ≈ 2,8 g); peça única, nenhum aviso; reconstrução 22,5 s (navegador do teste ~26 s; a
  prévia aparece na hora). Capturas: `docs/global/capturas/j9a/`.

### Ornamentos (J7) — como desenhar
- Joia → **Ornamento** (ou Construtores → Ornamentos → Desenhar) abre o esboço do WJCAD no lugar da vista 3D
  (carregado só nessa hora). **Horizontal = ao longo do aro (0 = topo); vertical = largura do aro.** As linhas
  tracejadas fixas são guias (bordas do aro e caixa da gema central); entidades de construção não viram fio.
- Desenhe só um quadrante: a **simetria** (dois eixos, esquerda↔direita, frente↔trás ou nenhuma) completa o resto e
  aparece em cinza enquanto se desenha. Comprimento desenhado = comprimento real sobre o topo do aro.
- Toque num fio para mudar **Ø no início/fim** e **altura no início/fim** (vazio = padrão do ornamento); toque num
  ponto para escolher **bolinha** ou **pedrinha em inglesa** (Ø e gema). ✓ Concluir ornamento volta ao 3D.
- Vários ornamentos por joia (camadas), cada um com liga/desliga.

## 3. Regras de cálculo

- **Tamanho**: Ø interno = (40 + n)/π (Brasil), C/π (ISO 8653, C = circunferência), 11,63 + 0,8128·n (EUA).
  A numeração brasileira varia entre lojas: a interface lembra de conferir com o calibrador.
- **Quilates**: redonda 0,0061·D²·prof.; demais fator·C·L·prof. (oval 0,0062, gota 0,00615, navete 0,0058,
  princesa 0,0083, esmeralda 0,0092, coração 0,0059, almofada 0,0081, baguete 0,00915, trilliant 0,0057);
  outras gemas × densidade/3,52. 1 ct redonda ≈ 6,5 mm.
- **Ligas** (g/cm³, confirmar com o fornecedor): ouro 750 amarelo 15,5 / branco 15,9 / rosé 15,1, ouro 585 13,1,
  ouro 999 19,3, prata 925 10,36, platina 950 20,7, paládio 950 12,0; resina calcinável 1,15.
- **Gemas livres**: posição "sobre o aro" = R + superfície(θ, lateral) + altura (radial); "relativa à central" = no raio do
  ângulo θ, na altura Y = cintura da central + altura (até ±75°). Orientação = base (tangente/normal do aro, ou de pé) ·
  giro em Y · inclinação em torno do eixo curto. Cópia espelhada = S·M·(lateral invertida), que continua rotação (as
  lapidações são simétricas no eixo lateral). Garra: topo no contorno + Ø/4 na altura cintura + 0,55·coroa; joelho a
  0,3·pavilhão; haste do joelho até o apoio mais próximo (aro 0,25 mm para dentro, centro do fio, eixo da garra da central).
  Aviso: folga > 1,5 mm (sem apoio), > 4,5 mm (fora do metal). Ramo do aro dividido: centro = (vão + meia largura)/2 +
  afastamento·(1 + cos(πθ/divisão))/2.
- **Mínimos** por liga (aviso): garra 0,6 mm (ouro, platina) / 0,8 mm (prata, ouro 24k 0,9); aro 1,0 / 1,2 / 1,4 mm.

## 4. Interface

- **Gemas livres** (árvore, Joia → Gemas livres ou Gemas → Gemas livres): lista com liga/desliga por gema, Nova (escolhe
  a lapidação), Duplicar, Excluir, Peso (ct) que redimensiona e os campos de posição, orientação, engaste e simetria.
  **Posicionar tocando na vista**: com o botão ligado, um toque curto (caneta, dedo ou clique) na joia leva a gema até
  lá (θ e lateral; a altura fica); arrastar continua girando. Tocar numa gema livre a seleciona (contorno azul).

- Esquerda: **construtores** (Aro, Cabeça, Pavé, Gravação, Textura, Fabricação, Preço) com liga/desliga.
  Celular: a lista some e cada construtor abre pela faixa; o painel tem "Desligar".
- Centro: vista 3D ortográfica; esquerdo ou meio giram, direito desloca, roda aproxima; 1 dedo gira, 2 dedos
  aproximam/deslocam; F enquadra; Ctrl+Z/Y desfaz/refaz.
- Direita: propriedades do construtor + **resultados** (peso na liga, ct, Ø, volume, área de polimento,
  peso com perda, resina, custo e venda) e **avisos** de fabricação.

## 5. Prompt usado (refeito a pedido do Johann, 07/11/2026)

> Implemente o WJGoldDiamond (fases J0–J6 de `docs/global/wjgolddiamond.md`) como face nova do
> WJProMaster, do jeito mais simples, leve e correto: reaproveite o kernel OpenCascade, a casca comum,
> o cofre e a fonte de texto do WJCAD; motor puro testado em Node; geometria testada com volumes;
> booleanas robustas (várias ferramentas, conferidas pelo volume); nada de nomes de terceiros na
> interface; valide no navegador simulando o tablet (1280×800, toque); documente o estado; publique
> (PR → CI → merge → deploy) sem trabalho manual.

**Fios (J7)**: varredura de um círculo ao longo da spline (aproximada a 0,03 mm) com **lei linear** do OpenCascade
para o Ø variável; as pontas da trajetória são **aparadas 0,6·r** e cobertas por esferas (repetidas removidas).
Arestas exatamente coincidentes (ponta do fio = esfera, fio = fio espelhado no eixo) deixavam a booleana 3–5× mais
lenta e com volume errado. Loft de círculos foi descartado: em voltas fechadas (volutas) ele se autointercepta.
A prévia do worker passou a ser o composto de tudo **sem booleanas** (aparece na hora); peso e volume só na final.

**Escultura (J8)**: `src/joia/escultura.ts` (puro: icosfera, formas iniciais, pincéis, codificação) e
`src/joia/uniao.ts` (`manifold-3d`). A topologia sai só de (forma, nível); o arquivo guarda as posições
quantizadas em 16 bits (base64: ~80 kB no nível 5, ~330 kB no 6). A vista mostra o metal paramétrico e as
esculturas como malhas separadas (mesmo material); o worker faz a união só na versão final (peso/área) e na
exportação STL (contração aplicada na malha final; canais pelo OpenCascade antes da união). Dependência nova
`manifold-3d` 3.5.4 (Apache-2.0, a mesma das booleanas do OpenSCAD): só o núcleo `manifold.js` + `.wasm`
(540 kB, carregado só com escultura); as dependências do editor CAD do pacote foram cortadas com `overrides`
no `pnpm-workspace.yaml` (o lockfile ganha só ele).

## 6. Estado (21/11/2026)

J0–J6 entregues. Tempos medidos em Node (o tablet tende a ser 1,5–2× mais lento; a prévia aparece antes):
aliança 30 ms, afunilado 0,1 s, solitário ~1 s, lapidações curvas 2–4 s, solitário com pavé ~6 s,
eternidade com 35 pedras ~8 s, anel vintage com filigrana (16 fios, 3 gemas) ~13–17 s (no navegador do teste,
sem GPU, ~20 s; a prévia completa aparece antes), **anel folhas com oval (9 gemas, 64 garras-cápsula, 12 fios,
8 folhinhas) 22,5 s em Node / ~26 s no navegador do teste**; gema livre isolada ~2,5 s. Limites conhecidos: gemas do pavé ficam radiais (não inclinam nas
fileiras laterais de perfis curvos); a torção usa loft (mais lenta com pavé); texturas só no aro.
