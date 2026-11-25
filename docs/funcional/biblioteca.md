# Biblioteca de componentes — elementos de fixação (WJCAD › Montagem)

> Pedido C2 (21/11/2026). Nome nosso: **Biblioteca de componentes** (o nome da biblioteca do CAD de referência
> nunca aparece). Inspirada na biblioteca de componentes padrão dos CADs profissionais: parafusos, porcas,
> arruelas, rebites e pinos prontos, paramétricos e encaixados em furos da montagem.

## Estado (21/11/2026)

✅ Painel com busca e árvore · ✅ ~200 peças (17 famílias × tamanhos M2–M30, passo grosso e fino) geradas no kernel ·
✅ rosca cosmética (padrão) e **real** (parafusos) · ✅ salvar em **CAD › Biblioteca** com nome padronizado e reaproveitar ·
✅ encaixe por **arrasto/toque** num furo (concêntrico + coincidente) · ✅ **repetir em todos os furos iguais** ·
✅ **comprimento sugerido** pela espessura atravessada · ✅ propriedades (norma, material, massa, descrição) na lista de
materiais · 🟡 tabelas marcadas "≈" (forma/cotas aproximadas, ver §2) a conferir na norma · ⏸ dentes da arruela dentada, mola helicoidal da
arruela de pressão, rosca real em porca, furo roscado detectado pela rosca cosmética do furo assistido, arrastar do painel para
furo sob a câmera isométrica em celular.

## 1. Como usar

1. Montagem → aba **Montagem** → **Biblioteca de componentes**. Painel à esquerda.
2. **Buscar** (ex.: "allen", "ISO 4032", "arruela") ou abrir a árvore **Parafusos · Porcas · Arruelas · Rebites · Pinos**
   e tocar o tipo/norma.
3. Escolher **Tamanho** (M2…M30 ou Ø), **Passo da rosca** (grosso ou fino), **Comprimento** — "Sugerido pela espessura" (padrão),
   um valor da lista do padrão ou "Outro valor…" — e, nos parafusos, **Rosca real**.
4. Encaixar:
   - **Arrastar** o botão "⠿ Arraste até o furo" e soltar sobre a parede do furo no modelo (mouse, caneta ou dedo); ou
   - tocar o botão (arma) e tocar a parede do furo; ou
   - tocar só o furo (sem armar): mostra Ø, espessura atravessada, compatibilidade com o tamanho e o comprimento sugerido.
5. Se houver outros furos iguais (mesmo Ø, eixo paralelo e mesma espessura), o app pergunta **"Repetir em todos os furos iguais?"**
   (Só neste furo / Em todos).
6. **Lado oposto**: a peça entra pelo lado do furo voltado para a câmera; marcar "lado oposto" para entrar pelo outro (porca).
7. **Ordem para empilhar**: arruelas e porcas empilham sozinhas sobre o que já está no mesmo lado do furo (arruela sob a
   cabeça, arruela sob a porca): insira **primeiro as arruelas**, depois o parafuso/porca. A cabeça do parafuso não empilha.
8. **Inserir solto**: coloca o item ao lado do modelo, sem furo, para posicionar depois (Posicionar/Mover).

## 2. Famílias e tabelas (`src/biblioteca/dados.ts`)

| Grupo | Tipo | Norma | Tamanhos | Cotas das tabelas | Conferência |
|---|---|---|---|---|---|
| Parafusos | Sextavado | ISO 4017 (DIN 933) | M2–M30 | s, k | norma |
| | Allen cilíndrico | ISO 4762 (DIN 912) | M2–M30 | dk, k, s, t | norma |
| | Escareado | ISO 10642 (DIN 7991) | M3–M20 | dk, k, s, t | norma |
| | Abaulado | ISO 7380-1 | M3–M12 | dk, k, s, t | norma |
| | Prisioneiro | DIN 938 | M4–M30 | (corpo roscado) | norma |
| | Sem cabeça | ISO 4026 | M2–M24 | s, t | norma |
| Porcas | Sextavada | ISO 4032 (DIN 934) | M2–M30 | s, m | norma |
| | Autotravante | ISO 7040 | M3–M24 | s, m (altura total) | ≈ aproximada |
| | Castelo | DIN 935 | M5–M24 | s, m, n | ≈ aproximada |
| | Borboleta | DIN 315 | M3–M12 | forma simplificada | ≈ aproximada |
| Arruelas | Lisa | ISO 7089 (DIN 125) | M2–M30 | d1, d2, h | norma |
| | De pressão | DIN 127 B | M3–M24 | d1, d2, s (altura 2 s, com fenda) | ≈ aproximada |
| | Dentada | DIN 6798 A | M3–M20 | d1, d2, s (anel liso, sem dentes) | ≈ aproximada |
| Rebites | De repuxo | ISO 15977 | Ø2,4–Ø6,4 | dk, k, furo | ≈ aproximada (alumínio) |
| | Maciço | ISO 1051 (DIN 660) | Ø2–Ø10 | dk = 1,75 d, k = 0,7 d | norma (proporções) |
| Pinos | Elástico | ISO 8752 | Ø2–Ø20 | parede s (com fenda) | ≈ aproximada |
| | Cilíndrico | ISO 2338 | Ø1–Ø20 | maciço | norma |

- Passos: grosso (ISO 261) e fino usual (M8×1, M10×1,25 e ×1, M12×1,5 e ×1,25 … M30×2); nome fino: "Parafuso ISO 4762 M8x1x30".
- Comprimento: lista do padrão (2, 3, 4, 5, 6, 8, 10, 12, 14, 16, 18, 20, 22, 25 … 200 mm) limitada à faixa de cada tamanho
  (`lmin`–`lmax` na tabela); fora da faixa o app recusa com a mensagem da faixa.
- **"≈ aproximada"** = família de forma simplificada ou com cotas por proporção; aparece na lista e no cartão do cofre. O Johann confere
  contra a norma dele e corrigimos o arquivo de dados (um lugar só).
- Material de fábrica: aço 1045 (7,85 g/cm³); rebite de repuxo alumínio 5052; rebite maciço aço 1020. Pode ser trocado na peça.

## 3. Geometria (`src/biblioteca/gerar.ts`)

- Cada peça é um **documento WJCAD comum** (esboços + extrusões/revoluções): abre na Peça e se edita como qualquer outra.
- **Convenção**: eixo da peça = **Y**; plano XZ (y = 0) é o **apoio**. Cabeça/porca/arruela em y ≥ 0; haste em y ≤ 0 (ponta em
  y = −L). Escareado: topo da cabeça em y = 0, cone desce. Pinos: y ∈ [−L, 0].
- Rosca **cosmética** por padrão (haste em Ø nominal; furo da porca = diâmetro menor D1 = d − 1,0825 P). Rosca **real**
  (parafusos): recurso "rosca" (sulco ISO em V); rosca total nos de rosca total (ISO 4017, prisioneiro, sem cabeça), nos demais b = 2d + 6.
  Mais lenta (~2 s por peça); porcas ficam cosméticas.
- Propriedades gravadas na peça (`Documento.propriedades`): norma, descrição, material, tamanho, comprimento, passo, rosca, conferência,
  altura de apoio, grupo e família.

## 4. Cofre

- A peça é salva na primeira vez em **CAD › Biblioteca** como `Parafuso ISO 4762 M6x20.wjcad` (nome padronizado; rosca real ganha
  "(rosca real)"), **publicada e sem GO-OUT**, e **reaproveitada** se o nome já existir (nenhuma duplicata, nenhuma nova versão).
- Cartão de dados do cofre já nasce com **código** (= nome), **descrição**, **material** e observação com a norma.

## 5. Encaixe (`src/biblioteca/encaixe.ts`)

- Furo = face **cilíndrica côncava** (normal para o eixo, lida da malha); espessura atravessada = comprimento da face (área ÷ 2πr).
- Entrada = ponto do eixo no fim do furo voltado para a câmera; o +Y do fixador aponta para fora da peça.
- Dois posicionamentos: **Concêntrico** (eixo Y do fixador × face do furo) e **Coincidente** (plano XZ do fixador × face plana de apoio)
  ou **Distância** (altura já empilhada de arruelas/porcas). Sem face plana de apoio só o concêntrico é criado.
- **Furos iguais**: mesmo raio (±0,01 mm), eixo paralelo, mesma espessura (±0,05 mm); cada instância ganha os seus posicionamentos.
- **Comprimento sugerido** = espessura + altura empilhada sob a cabeça + (porca e arruela do outro lado + 2 passos de rosca, ou em furo
  roscado 1,5 × d de engate); escolhe o menor valor da lista do padrão ≥ o mínimo (marcador "Com porca e arruela" no painel).
- **Compatibilidade** mostrada ao tocar o furo: folga, furo de rosca (d − 1,0825 P), apertado, pequeno ou folga grande demais.

## 6. Lista de materiais

Colunas **ITEM, CÓDIGO, DESCRIÇÃO, NORMA, MATERIAL, MASSA (g), QTD** (e CSV): a descrição vem do cartão do cofre ou das propriedades da
peça; a massa é volume do kernel × densidade do material.

## 7. Testes

- `scripts/teste-biblioteca.ts` (no `pnpm teste`): tabelas conferidas, nomes, as ~200 peças geradas, **volume/massa de 5 itens
  contra a conta direta das cotas da norma** (ISO 4017 M8x30, ISO 4762 M6x20, ISO 4032 M8, ISO 7089 M8, ISO 2338 Ø6x20 + escareado e
  rebite), rosca real, posição (eixo Y, apoio), furos/entrada/pose, mates resolvidos pelo solver (inclusive peça fora do lugar),
  pilha de arruela/porca, comprimento sugerido e compatibilidade.
- `scripts/roteiro-biblioteca.cjs` (tablet 1280×800, Playwright): chapa com 2 furos → Allen M6 nos 2 furos → arruela por arrasto →
  porca pelo lado oposto → lista de materiais.
