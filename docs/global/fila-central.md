# Fila da central (estado e prompts) — fonte durável; atualizar ao avançar


CABEÇALHO (pôr antes de cada prompt):
(Pedido enviado pela central do WJProMaster em nome do Johann, que não acompanha esta conversa ao vivo. Siga o CLAUDE.md até o fim: check/teste/build, PR, CI verde e MERGE. Dúvida de requisito: escolha a opção mais segura e simples, registre no PR e siga; só pare se for impossível continuar. Última mensagem: "PRONTO: PR #N mesclado, versão publicada" ou "BLOQUEADO: motivo".)

1. WJPDM — PRONTO PR #127 (15/11)
2. WJCAD referências — PRONTO PR #128
3. WJCAD 1ª caixa — PRONTO PR #129 (pendente: arestas do laço)
S1 — PRONTO PR #131 (Opus, ≈ US$ 17)
C4 — PRONTO PR #132 (Opus, ≈ US$ 13,9)
S2 — PRONTO PR #133 (Sonnet, ≈ US$ 4,3)
S3 — PRONTO PR #134 (Sonnet, ≈ US$ 8,4)
P1 — RETOMADO 25/11 sem os dados do Johann (reproduzir pelo app; Opus, sessão session_01MWdNyhborw7w7J1eE9tsh8; ≈ US$ 8,5 até a pausa)
C3 — EM ANDAMENTO desde 25/11 (Opus, sessão session_01MWdNyhMm1KtVNbtPZUvvar, ramo claude/c3-engrenagens)
C2 — PRONTO PR #142 (24/11, Sonnet, ≈ US$ 11,3; pendência: conferir as famílias "≈ aproximada" em src/biblioteca/dados.ts)
C1 — PRONTO PR #137 (21/11, Sonnet, ≈ US$ 1,2)
**FILA RETOMADA (Johann, 25/11; semana 22 %, sessão 24 % ao retomar):** J9b, P1 e C3 em paralelo. Passou de 70 % (semana ou sessão) ou aviso de limite = parar todas (push imediato).
**Fora da fila, em paralelo (Johann, 21/11): J9a (Opus) → J9b (Opus), em sequência** (só WJGoldDiamond, src/joia/; não cruza com C1/C2/C3). J9b só depois de "PRONTO" do J9a; parte do main com o J9a.
J9a — PRONTO PR #139 (21/11, Opus, ≈ US$ 15,8; 2,97 g, 9 gemas, reconstrução ~22 s)
J9b — RETOMADO 25/11 (Opus, contexto ~51 %, sessão session_01MWdNyhFZCWjbWJb91ALqhi; ≈ US$ 16,8 até a pausa)
Objetivo do J9: modelar no WJGoldDiamond, a partir de UMA foto, um anel igual ao da foto (ANEL AMOR, descrito no J9a), pronto para resina e fundição; tudo em parâmetros para o Johann ajustar olhando a foto no app (J9b). Inspiração só de FUNÇÃO nos CADs de joalheria; nenhum nome, ícone ou texto de terceiros na interface.
Custos Opus: 1 ≈ 10,1 · 2 ≈ 9,5 · 3 ≈ 9,6 (US$ de tabela). Modelo: Sonnet em S2, S3, C1, C2; Opus no C3; Sonnet falhou/travou → refazer em Opus.
LIÇÃO 21/11: três conversas em paralelo (C1, C2, J9a) bateram no limite de 5 h; pedir push cedo e a cada etapa. Desde 25/11 (Johann): sem limite de paralelo; excedeu = parar.
NOTA: conferir só com get_session (post_turn_summary) e lista de PRs; list_events é caro. A central tem de ser aberta pelo Johann (conversa criada por outra conversa não tem create_session/get_session). WJFlow e agente: só futuro.

## 2. WJCAD referências persistentes
Face/lugar: WJCAD › Peça › referências de faces/arestas e esboço sobre face.

Hoje (causas da central, reproduzir antes de corrigir):
A) Filete perde as arestas ao mudar a cota do retângulo. acharAresta (src/kernel/topologia.ts:200) reencontra só pelo meio da aresta + comprimento, com tolerância de 0,3 × comprimento: 80 → 120 mm desloca o meio e muda o comprimento → "aresta não existe mais". O mesmo vale para acharFace (:183).
B) Rasgo vira furo. Caixa 80×100 do centro no plano Frontal, extrusão de 100; esboço na face lateral com um retângulo cruzando a borda superior; corte passante. Mudar a altura: a borda se move (simétrica) e o rasgo fica parado → furo no meio. Prováveis causas:
   - as referências do modelo no esboço (geo.externa) só se atualizam ao abrir o esboço (src/esboco/editor.ts:307), não na reconstrução;
   - encaixar na aresta da peça não cria relação com ela.

Quero:
1. Nome persistente, como nos CADs profissionais: cada face pela história (recurso + entidade do esboço que a gerou; tampa/base = início/fim da extrusão); aresta = par de faces. A assinatura geométrica fica só como reserva. Referências antigas migram sozinhas na primeira reconstrução.
2. A reconstrução atualiza as referências do modelo de todos os esboços antes de resolvê-los.
3. Encaixar ponto ou linha numa aresta da peça cria Coincidente/Colinear com ela (relação automática; Ctrl suprime), para o rasgo acompanhar a borda.
4. Referência que mesmo assim não for achada: aviso no recurso apontando qual, sem derrubar os recursos seguintes.

Testes em Node:
- caixa → filete nas 4 bordas → 80 → 120 e 100 → 60 → filete nas mesmas arestas;
- caso do rasgo → continua rasgo ao subir e ao descer a altura;
- STEP importado continua pela assinatura.
Roteiro no tablet. Atualizar docs/funcional/features.md e sketch.md.

## 3. WJCAD 1ª caixa ativa + auto-seleção
Face/lugar: WJCAD › painel de todos os comandos com seleção (src/ui/esquemas.ts) e Filete.

Quero:
1. Abrir qualquer comando com caixa de seleção: a primeira caixa vazia já fica ativa (rosa), pronta para tocar na geometria. Com pré-seleção, ela entra na caixa certa e a próxima caixa vazia fica ativa. Ao encher uma caixa de um item só, pula para a próxima.
2. Filete/Chanfro, barra de seleção rápida ao tocar uma aresta (como no CAD de referência):
   - todas as arestas da face;
   - arestas do recurso (as que um recurso criou, ex.: o Corte);
   - todas as côncavas / todas as convexas;
   - a propagação tangente continua como está.
   Prévia antes de confirmar; desfazer.

Testes: roteiro no tablet (caneta, dedo, mouse) em Filete, Chanfro, Furo, Padrão, Espelhar e Plano; caso puro da escolha das arestas em Node. Atualizar docs/funcional/features.md.

## S1. WJSlicer3D impressoras e tempo real
Face/lugar: WJSlicer3D (src/slicer/: perfis.ts, main.ts) — só orçamento: nunca G-code nem envio para impressora.

Quero:
1. Só duas impressoras: P1S e Kobra 3 (bico 0,4; perfis de fábrica de camada, velocidades, acelerações, fluxo máximo). Remover as outras.
2. Tempo por fatiamento real, reimplementado com código nosso:
   - perímetros, preenchimento (padrões principais), topo/fundo, suportes (normal e árvore), borda/saia;
   - caminhos com acelerações e limite de fluxo; deslocamentos; trocas de camada;
   - meta: ±5 % do fatiador de referência nas mesmas configurações.
   O fatiador de código aberto de referência é AGPL: proibido copiar código; o nome dele nunca aparece.
3. Prévia das camadas (deslizante), tempo por tipo de caminho, material (g, m), várias peças na mesa.
4. Calibração por impressora (fator de tempo medido) continua.
Fatiamento em Web Worker, sem travar a interface no tablet.

Testes: casos em Node (cubo, cilindro, peça com balanço) com tempo e material conferidos contra valores de referência medidos pelo Johann (registrar no PR quais valores faltam, sem parar); roteiro no tablet. Atualizar docs/global/wjslicer3d.md.

## S2. WJSlicer3D pintura multicor
Face/lugar: WJSlicer3D › pintura de cores (depois do S1).

Quero:
1. Pintar o corpo: pincel (tamanho), balde por face/região contínua, preencher por ângulo, borracha; até 4 cores por peça nas duas impressoras (P1S e Kobra 3, um sistema de 4 cores cada). Caneta pinta, dedo navega. Desfazer.
2. Também pintar por corpo inteiro (peça multicorpo do WJCAD ou STL com vários corpos).
3. Custo da cor no orçamento:
   - nº de trocas por camada;
   - purga por troca (volume editável por impressora, padrão de fábrica);
   - torre de purga;
   - tempo de cada troca.
   Tudo somado ao material (g por cor) e ao tempo.
4. Cores e filamentos vêm da biblioteca de custos (S3): cor, material, R$/kg. (Se o S3 ainda não existir: cor + R$/kg editáveis no projeto, preparados para a biblioteca.)
5. A pintura fica salva no projeto do WJSlicer3D, guardado no cofre.

Testes: Node (contagem de trocas e purga num cubo com 2 e 4 cores) e roteiro no tablet com caneta. Atualizar docs/global/wjslicer3d.md.

## S3. WJSlicer3D biblioteca de custos, orçamento e proposta
Face/lugar: WJSlicer3D › orçamento; WJWrite › proposta comercial.

Referências do Johann no Google Drive (ler pelo conector; NÃO versionar, são dados comerciais):
- MATRIZ_V01.xlsx: cálculos e funcionalidades do orçamento. Usar exatamente o mesmo cálculo de lucro dela (markup ou margem: conferir);
- PROPOSTA COMERCIAL GRAFIX.docx: modelo da proposta.

Quero:
1. Tela "Biblioteca de custos":
   - item = categoria (Material comprado, Mão de obra H-H, Serviço, Filamento, Máquina), nome, unidade (kg, h, un, m…), custo por unidade e lucro padrão %;
   - exemplos: Chumbo 60 R$/kg 0 %; H-H Modelagem 30 R$/h 0 %; Ímã 10×4 R$ 5/un 30 %;
   - incluir, editar, duplicar, desativar, buscar;
   - um arquivo só no cofre (igual em todos os aparelhos);
   - quando o WJERP tiver itens com código, puxar de lá.
2. Orçamento:
   - linhas da impressão (do fatiador: filamento por cor + horas de máquina + purga);
   - "+ Item da biblioteca" com quantidade (custo = quantidade × custo por unidade);
   - em cada linha: custo, lucro % editável ali mesmo (padrão do item) e preço;
   - totais: custo, lucro (R$ e %), preço final;
   - os valores ficam gravados no orçamento (mudar a biblioteca não muda orçamento antigo);
   - demais campos e regras como na MATRIZ_V01.
3. Proposta comercial gerada no WJWrite a partir do modelo do .docx:
   - cliente, itens, preços, prazos e condições;
   - imagens: vista isométrica automática de cada peça + vistas escolhidas no WJCAD;
   - salva no cofre; exporta PDF e DOCX.
4. Peças vindas do WJCAD (menu → Estimar impressão 3D) ou STL do cofre/aparelho.

Testes: Node (contas da matriz em 3 casos, conferidos contra a planilha) e roteiro no tablet até a proposta gerada. Atualizar docs/global/wjslicer3d.md e documentos.md.

## WJFlow W1–W4: NÃO EXECUTAR (Johann, 15/11) — pendência futura
## W (cabeçalho comum do WJFlow, antes de cada W1–W4)
Face/lugar: WJFlow (docs/global/wjflow.md; simulador LBM já existente).
Inspirado num fluxo profissional de projeto de asa para AeroDesign; nomes de terceiros nunca aparecem (software de referência, programas de perfis e de CFD).
Interface: etapas em sequência (Perfis → Geometria → VLM → Domínio → Malha → CFD → Validação), projeto .wjflow no cofre.
Cada conversa termina com testes em Node + roteiro no tablet e atualiza docs/global/wjflow.md.

## W1 Perfis
Banco de perfis abertos + importar .dat. Polar por método de painéis com camada limite, código nosso, Re de 50 mil a 1 milhão (Cl, Cd, Cm × α; estol). Validar contra dados publicados de 3 perfis.

## W2 Geometria
Asa, EH, deriva e fuselagem por parâmetros (envergadura, cordas por seção, enflechamento, diedro, torção, perfil por seção; fuselagem por seções). Gera .wjcad com recursos EDITÁVEIS (loft por seções) no cofre.

## W3 VLM
CL, CD induzido + perfil, L/D, estol, margem estática (asa + EH + deriva), em varredura de velocidades e ângulos com altitude/densidade do projeto. Validar contra caso publicado de asa retangular e enflechada.

## W4 CFD e validação
Domínio de meio modelo (inlet, outlet, symmetry, paredes nomeados) no nosso simulador. Malha = resolução da rede. Gráfico VLM × CFD no mesmo eixo; GCI com 3 refinamentos, permitido no tablet e no computador (avisar o tempo estimado antes de rodar).

## C1. WJCAD vista 3D em escala real 1:1 (fila, depois do S3)
Face/lugar: WJCAD › Peça, Montagem e Desenho › vista 3D. Reaproveitar a calibração da Escala 1:1 do esboço (src/esboco/escalaReal.ts; ⚙ Configurações › Esboço; TCL TAB A1 Plus já calibrado pela ficha da tela).

Quero:
1. Botão "Escala real 1:1" na barra de vistas (e atalho): a vista 3D passa a mostrar a peça no tamanho real na tela (50 mm na peça = 50 mm medidos na tela), com a vista ortográfica.
2. Com a escala ligada: zoom travado (roda/pinça avisam "Escala real ligada"); girar e arrastar (pan) livres, para ver qualquer detalhe de peça maior que a tela; F (enquadrar) centraliza o ponto tocado sem mudar a escala.
3. Desligar volta ao zoom anterior. Lembrar o estado por janela.
4. Aparelho sem calibração: pedir a calibração (a mesma tela do esboço) antes de ligar.
Testes: Node (conta pixels por mm × zoom da câmera) e roteiro no tablet (cubo de 50 mm medido em px na tela com a calibração simulada; pan e giro com dedo/caneta/mouse). Atualizar docs/funcional/ e regras.md §6.

## C2. WJCAD biblioteca de componentes: elementos de fixação (fila, depois do C1)
Face/lugar: WJCAD › Peça e Montagem › "Biblioteca de componentes" (nome nosso; o nome da biblioteca do CAD de referência nunca aparece). Inspirada na biblioteca de componentes padrão do CAD de referência.

Quero:
1. Painel com busca e árvore por norma/tipo: parafusos (sextavado, Allen cilíndrico, escareado, abaulado, prisioneiro, sem cabeça), porcas (sextavada, autotravante, castelo, borboleta), arruelas (lisa, de pressão, dentada), rebites (repuxo, maciço), pinos (elástico, cilíndrico). Normas ISO/DIN métricas (M2–M30, passo grosso e fino); dados de tabela em arquivo de dados nosso, conferidos com as normas.
2. Escolher tipo + tamanho + comprimento (lista do padrão ou valor) → peça paramétrica gerada no kernel (rosca cosmética por padrão, rosca real opcional), salva no cofre na pasta "Biblioteca" com nome padronizado (ex.: "Parafuso ISO 4762 M6x20") e reutilizada se já existir.
3. Na Montagem: arrastar para um furo encaixa (concêntrico + coincidente) e oferece "repetir em todos os furos iguais" do padrão; comprimento sugerido pela espessura atravessada.
4. Propriedades (norma, material, massa, descrição) preenchidas para a lista de materiais.
Testes: Node (volumes/massa de 5 itens contra a tabela da norma) e roteiro no tablet (inserir parafuso + porca + arruela em furo da montagem). Atualizar docs/funcional/ e regras.md §6.

## C3. WJCAD gerador de engrenagens (fila, depois do C2)
Face/lugar: WJCAD › Biblioteca de componentes › Engrenagens (mesmo painel do C2).

Quero:
1. Tipos: dentes retos, helicoidais, cremalheira, cônicas (retas), coroa e sem-fim, internas.
2. Entrada só do necessário: módulo, nº de dentes, ângulo de pressão (20° padrão), largura, ângulo de hélice e sentido, furo/cubo/rasgo de chaveta, deslocamento de perfil; o resto calculado e mostrado (diâmetros primitivo/externo/raiz, distância entre centros do par, razão).
3. Perfil evolvente exato (não aproximado) gerado no kernel; peça paramétrica editável depois (valores no recurso), salva no cofre.
4. Par: escolher as duas engrenagens → distância entre centros e posição na Montagem com engrenamento correto (relação de engrenagem no mate, se existir).
Testes: Node (geometria do perfil evolvente: espessura do dente no primitivo = π·m/2 ± tolerância; diâmetros conferidos) e roteiro no tablet. Atualizar docs/funcional/.

## Futuro (não executar)
- Agente no notebook para abrir o fatiador do fabricante com o STL (Opção 2; decidir depois do S3).

## C4. WJCAD: relação com aresta da peça, calculadora em todos os campos, cotas no duplo clique (fila, depois do C3 — ou antes do C1 se o Johann pedir)
Face/lugar: WJCAD › esboço sobre a peça; painéis de comando; cotas sobre o modelo.

Hoje (relato do Johann, 15/11; causas prováveis da central, reproduzir antes de corrigir):
A) Num 2º esboço sobre a peça extrudada, desenhar uma linha em cima de uma aresta do modelo não cria Coincidente nem Colinear. O #128 (item 3) devia criar: conferir se a relação nasce só ao encaixar em ponto e não ao desenhar sobre a aresta (src/esboco/relacoesAuto.ts, editor.ts), e se a aresta da peça entra como referência (geo.externa) automaticamente.
B) Duplo clique no corpo/recurso para editar cotas: a cota da extrusão (D1) não aparece. rotulosDoRecurso (src/main.ts, "valores do recurso") usa viewport.centroFaces(facesPorRecurso[f.id]) e pula em silêncio quando não há centro: provável que facesPorRecurso da extrusão fique vazio depois do nome persistente (#128). Conferir em TODOS os recursos com PARAMETROS_RECURSO (src/configuracoes.ts). Aproveitar: a edição no modelo recusa zero e negativos (`n <= 0`), o que impede ΔX = −20 no Mover corpo: aceitar conforme o campo.
Quero:
1. Linha desenhada sobre aresta da peça (ou ponto sobre aresta/vértice) cria Colinear/Coincidente com a referência do modelo, com o símbolo antes de soltar; Ctrl suprime; nunca superdefinir.
2. Duplo clique/duplo toque no corpo ou no recurso mostra todas as cotas do recurso (esboços + D1/D2, ângulos, etc.), editáveis no lugar; aviso claro se algum recurso não tiver onde mostrar.
3. Botão calculadora (o mesmo teclado-calculadora das cotas, src/ui/tecladoCota.ts) em TODOS os campos numéricos: painéis de comando do WJCAD (esquemas.ts), ⚙ Configurações e caixas de valor; depois, via componente comum (src/comum/), nos campos numéricos das outras faces. Aceita expressão (=, variáveis) onde o campo já aceitava.
Testes: Node (relação com aresta externa; rótulos de todos os recursos com faces) e roteiro no tablet (linha sobre aresta, duplo toque mostrando D1, calculadora em 5 painéis diferentes). Atualizar docs/funcional/sketch.md e features.md.

## J9a. WJGoldDiamond — gemas livres + modelo "Anel folhas com oval" (fora da fila, 21/11, Opus)
Face/lugar: WJGoldDiamond (joia/, src/joia/: regras.ts, geometria.ts, main.ts, vista.ts, worker.ts, ornamento.ts, escultura.ts). Ler antes: CLAUDE.md, docs/global/regras.md e docs/global/wjgolddiamond.md.

Hoje:
- As pedras extras só entram como pavé ao longo do aro (J4) ou como "pedrinha em inglesa" REDONDA nos pontos do ornamento (J7).
- Não dá para pôr uma gema de qualquer lapidação (ex.: navete) num ponto livre, girada e inclinada, presa por garras próprias.

Quero:
1. Construtor novo "Gemas livres" (DocJoia.gemasLivres: GemaLivre[], liga/desliga por gema e no construtor):
   - gema: qualquer lapidação da biblioteca (J2), material, comprimento × largura (ct como hoje);
   - posição: ângulo θ ao longo do aro (0 = topo), deslocamento lateral e altura da cintura (absoluta ou relativa à cintura da gema central);
   - orientação: giro no plano (eixo longo, °), inclinação (°) e a opção "seguir a superfície";
   - engaste: garras (nº, Ø, ponta bolinha/alongada/dupla, como na cabeça) ou inglesa. Na navete, padrão = garras nas duas pontas (garra em V protegendo a ponta) + opção de garras laterais. As hastes descem até o apoio mais próximo (aro, ramo do aro dividido, fio de ornamento ou, depois do J9b, folha); sem apoio a ≤ 1,5 mm → aviso;
   - simetria por gema: nenhuma, esquerda↔direita, frente↔trás ou dois eixos (cópias contam na ficha);
   - duplicar gema; editar pelos campos e também tocar/clicar na vista para posicionar sobre a superfície, nos três perfis (caneta, dedo, mouse);
   - assentos de todas as gemas livres no MESMO corte em lote já usado (booleana conferida pelo volume, `segura`);
   - avisos: gema × gema, gema × garra da central, gema fora do metal, garra abaixo do mínimo da liga;
   - ficha técnica, ct total, peso, preço e CSV incluem as gemas livres por tipo/medida;
   - .wjgd antigo sem o campo abre igual (lista vazia); desfazer/refazer; GO-OUT/GO-IN do cofre.
2. Modelo pronto "Anel folhas com oval" em Joia → Modelos, nas medidas do ANEL AMOR:
   - aro BR 10 (circunferência 50 mm, Ø interno 15,92 mm), largura 1,80 mm, espessura 1,45 mm, ouro 750 amarelo;
   - aro dividido perto da cabeça (dois ramos que sobem até a cabeça);
   - central: oval 8 × 6 mm vermelha (rubi), eixo longo AO LONGO DO DEDO, 4 garras Ø 0,92 mm, cintura ~1,35 mm acima do aro;
   - ao longo do dedo: redonda 2,4 mm numa ponta da oval e redonda 2,0 mm na outra, com 4 garras cada;
   - de cada lado da oval, um leque de 3 navetes saindo dela como folhas: 1 de 2,5 × 1,25 mm e 2 de 2,0 × 1,0 mm (leque aprox. +50°, 0° e −50° em relação à transversal; registre onde pôs a de 2,5), garras nas pontas, um pouco abaixo da cintura da central. Total: 9 gemas;
   - folhinhas de metal entre as navetes e nos ombros (por ora, escultura J8 partindo da forma "folha"; o J9b troca por folhas paramétricas) e gavinhas/volutas (ornamento J7) onde o aro se divide, com simetria;
   - mínimos de fundição: fios estruturais ≥ 0,6 mm, garras ≥ 0,6 mm; metal esperado entre 2,5 e 3,5 g em ouro 18k (referência: o modelo v1 em Python deu 182 mm³ ≈ 2,8 g);
   - é ponto de partida editável: tudo em parâmetros/construtores.
3. Docs: docs/global/wjgolddiamond.md (J9a ✅; J9b "próximo"; seções 2/3/4/6 com tempos medidos) e CLAUDE.md (estado).

Testes:
- Node (scripts/teste-joia.ts, no pnpm teste):
  - gema livre isolada: posição/orientação das garras conferidas à mão;
  - a simetria gera as cópias certas;
  - colisão gera aviso;
  - volume com e sem assento confere;
  - .wjgd antigo abre.
- Modelo: Ø interno 15,92 ± 0,02 mm; 9 gemas; ct total coerente; sólido único fechado; peso na faixa; nenhum aviso de mínimo; tempo de reconstrução registrado.
- STL exportado e reaberto com volume igual (± 1 %).
- Playwright nos perfis Celular, Tablet 1280×800 com toque e Computador: abrir o modelo, mover uma navete pelo toque, aro 10 → 12 → 10, exportar STL; capturas no PR.
- pnpm check && pnpm teste && pnpm build; PR → CI verde → MERGE → publicado.

## J9b. WJGoldDiamond — referência por foto, fios avançados, folhas e concordância (fora da fila, depois do J9a, Opus)
Face/lugar: WJGoldDiamond (src/joia/: vista.ts, main.ts, ornamento.ts, editorOrnamento.ts, geometria.ts, uniao.ts, escultura.ts, regras.ts). Parte do main com o J9a. Ler antes: CLAUDE.md, docs/global/regras.md e docs/global/wjgolddiamond.md.

Hoje:
- Não há como pôr a foto da joia como referência: o Johann modela no olho.
- Os fios do ornamento (J7) só têm perfil redondo, com altura e Ø só no início e no fim, e não torcem. Os ramos de anéis de folhas são achatados, torcidos e sobem e descem ao longo do caminho.
- A folha só sai esculpida à mão (J8): demora e fica irregular para fundir.
- A união de fios, folhas, garras e aro é seca, sem transição suave.

Quero:
1. Imagem de referência (por joia, salva no .wjgd, com liga/desliga):
   - carregar foto (galeria, câmera ou arquivo); opacidade; por trás do modelo ou por cima, semitransparente;
   - fixar a foto numa vista (Frente, Cima, Lado) OU no modo "alinhar câmera à foto": o Johann marca 2–4 pontos na foto e os pontos correspondentes no modelo (ex.: as pontas da oval e o centro das redondas), e a câmera (posição, giro e campo de visão) se ajusta para casar a perspectiva;
   - escala pela medida conhecida (tocar nas duas pontas de algo e digitar a medida, ex.: oval = 8 mm);
   - a mesma foto aparece no esboço do ornamento para decalcar por cima;
   - botão "comparar": alterna e mistura modelo × foto no mesmo ângulo.
   A foto fica só no arquivo do Johann; nunca é enviada para fora do aparelho.
2. Fios avançados no ornamento:
   - perfil por fio: redondo, meia-cana, oval achatado (largura × altura) e faca;
   - Ø/largura, altura e inclinação variáveis ao longo do fio por pontos de controle (não só início/fim), com prévia;
   - torção do fio (voltas ao longo do comprimento) e fio "trançado" (dois fios torcidos um no outro), para os ramos;
   - fio que se apoia na superfície ou sobe livre em 3D até uma gema, garra ou folha (encaixe no apoio).
3. Construtor "Folhas" (paramétrico, sólido de fundição; a escultura continua como opção livre):
   - contorno: lanceolada, oval, coração e personalizado (spline do esboço); comprimento, largura e ponta (aguda/arredondada);
   - nervura central (vinco ou saliente, profundidade), dobra ao longo da nervura, curvatura no comprimento, espessura (mínimo da liga), borda arredondada;
   - posição e orientação como nas gemas livres (θ, lateral, altura, giro, inclinação, seguir a superfície), simetria, duplicar, posicionar tocando na vista;
   - "folha com pedra": a navete pode ficar engastada sobre/dentro de uma folha (a folha vira o apoio das garras);
   - o modelo "Anel folhas com oval" do J9a passa a usar estas folhas e os fios avançados nos ramos.
4. Concordância (transição suave) entre aro, fios, folhas, garras e cabeça: raio de concordância global (padrão 0,2 mm) e por peça. Use filete no OpenCascade onde funcionar e, como reserva, suavização local na malha unida (manifold-3d) só perto das junções, conferindo volume e espessura mínima depois. Prévia rápida sem concordância; a concordância entra na versão final e no STL.
5. Docs: docs/global/wjgolddiamond.md (J9b ✅; passa para "próximo" só o que sobrar do J9 antigo), seção 4 (como usar a referência por foto), CLAUDE.md (estado).

Testes:
- Node:
  - alinhamento de câmera: com 4 pontos sintéticos projetados de uma câmera conhecida, recupera a câmera (erro < 0,5 % na posição e < 0,5° no giro);
  - escala pela medida;
  - fio meia-cana/oval/faca com área de seção conferida à mão;
  - fio torcido com volume ≈ seção × comprimento (± 2 %);
  - folha: volume e espessura mínima;
  - concordância: sólido único fechado, volume só um pouco maior e nenhum ponto abaixo do mínimo;
  - .wjgd do J9a abre igual.
- Modelo "Anel folhas com oval" refeito com folhas e fios novos: fechado, peça única, peso entre 2,5 e 3,5 g, sem avisos de mínimo, tempo de reconstrução registrado (tablet: prévia em < 2 s).
- Playwright nos três perfis:
  - carregar uma foto de teste gerada pelo próprio app (render do modelo num ângulo conhecido, sem imagem de terceiros no repositório), alinhar a câmera pelos pontos e conferir a sobreposição;
  - escalar pela oval;
  - decalcar um fio no esboço;
  - pôr uma folha tocando na vista;
  - ligar a concordância e exportar STL.
  Capturas no PR.
- pnpm check && pnpm teste && pnpm build; PR → CI verde → MERGE → publicado.

## P1. WJCAD: filete lento na 2ª feature (relato do Johann, 24/11, Opus)
Face/lugar: WJCAD › Peça › reconstrução depois do Filete.

Hoje (relato do Johann ao modelar a "Caixa 60x60" de um desenho em PDF: caixa 60×60, cantos R6, altura 12,5 mm, parede de 2,5 mm): logo na 2ª feature, um filete simples, a reconstrução demorou muito.
Medição da central (Node, main a35241f): esboço 60×60 → extrusão de 12,5 → filete R6 nas 4 arestas verticais = ~0,1 s em `regenerar()` (tolerância 0,05 e 0,01). **O kernel não é o gargalo**: a demora está no caminho do app (worker ↔ interface): prévia do comando (item 3 do #129, "prévia antes de confirmar"), seleção rápida de arestas (#129), nomes persistentes / topologia (#128), rótulos de cotas no duplo clique (#132), salvamento no cofre, regenerarComRecuperacao repetindo, malha/arestas em tolerância fina ou reconstrução disparada mais de uma vez.

Quero:
1. Reproduzir no navegador (perfil Tablet 1280×800, toque) o caso do Johann: esboço do retângulo 60×60 → extrusão de 12,5 → Filete R6 nas 4 arestas verticais (escolhidas pelo toque) → confirmar. Medir com marcas de tempo (performance.mark) cada etapa: abrir o comando, cada toque de seleção, prévia, confirmar, mensagem ao worker, regenerar, malha, topologia, volta à interface, desenho, salvamento. Registrar a tabela no PR.
2. Corrigir a causa (ou causas) medida(s), sem perder função: meta ≤ 0,5 s do confirmar à peça na tela nesse caso, e prévia do filete ≤ 0,3 s por toque. Nada de trabalho pesado na thread da interface; prévia cancelada quando chega um toque novo; não reconstruir duas vezes o mesmo estado.
3. Conferir o mesmo caminho em Chanfro, Extrusão, Corte e Furo (mesmo padrão de lentidão?).
4. Guardar a medição como teste de desempenho (Node para o kernel + roteiro Playwright que falha acima do limite, com folga para o CI).
Testes: os acima + pnpm check/teste/build. Atualizar docs/funcional/features.md e tecnico.md (armadilha encontrada).
