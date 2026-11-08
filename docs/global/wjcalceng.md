# WJCalcEng — cálculos de engenharia do curso

Face do WJProMaster pedida pelo Johann em 07/11/2026: um lugar para **guardar as formas de calcular**
o que ele aprende no curso de engenharia. Cada cálculo é uma **calculadora** (módulo) da lista à
esquerda; o documento `.wjcalc` vive no cofre do WJPDM (pasta padrão **Cálculos**), como os
arquivos de todos os apps. Página `calceng/`, código em `src/calceng/`, motor testado em Node
(`scripts/teste-calceng.ts`, dentro do `pnpm teste`).

## 1. Calculadoras pedidas (roteiro)

| Calculadora | Estado |
|---|---|
| Centro de gravidade em 2D (esboço do WJCAD, relações, cotas, massa, momento de inércia) | ✅ C1 (07/11/2026) |
| Equação do 1º grau | ✅ (08/11/2026) |
| Equação do 2º grau | ✅ (08/11/2026) |
| Equações com mais de 2 variáveis (sistemas) | ✅ (08/11/2026) |
| Inequações | ✅ (08/11/2026) |
| Matriz 3×3 por Cramer e por Gauss | ✅ (08/11/2026) |
| Multiplicação de matrizes | ✅ (08/11/2026) |
| Leis de Newton | ✅ (08/11/2026) |
| Plano inclinado | ✅ (08/11/2026) |
| Força de atrito | ✅ (08/11/2026) |
| Trabalho | ✅ (08/11/2026) |

Todas entregues em 08/11/2026 (pedido: "continue com o desenvolvimento de todas as outras matérias"); detalhes no §3.

**Seletor de calculadoras** (07/11/2026, pedido do Johann: "organização das matérias por grupo, e uma
lupa de pesquisa"): o botão **Calculadora ▾** abre a lista agrupada por matéria — Estática e geometria
de massas · Álgebra · Álgebra linear — matrizes · Física — dinâmica — com a **lupa** no topo. A busca
ignora acentos e maiúsculas, aceita várias palavras e acha também por palavras-chave (ex.: "bhaskara",
"determinante", "3x3", "centroide"); Enter abre a primeira calculadora pronta. Catálogo e busca em
`src/calceng/modulos.ts` (testados em `teste-calceng.ts`); calculadora nova entra lá com `pronto: true`.

## 2. Centro de gravidade em 2D (C1)

### 2.1 Esboço = o esboço do WJCAD (07/11/2026, pedido do Johann)
"A forma de desenhar exatamente igual ao módulo de Sketch do CAD 3D, com os mesmos recursos e
relações com os objetos e com a origem." Por isso o WJCalcEng **usa o próprio editor de esboço do
WJCAD** (`src/esboco/`: `EditorEsboco`, `renderizarPainelEsboco`, solver PlaneGCS), sem cópia:
melhoria no esboço do WJCAD chega aqui sozinha.
- Faixa = a aba **Sketch** do WJCAD (`ABAS` de `src/comandos.ts`, mesmos ícones e menus ▾): selecionar
  (toque, caixa, traço, laço), cota inteligente, linha, retângulo (5 tipos), rasgo, círculo, arco,
  polígono, spline, elipse/parábola, filete/chanfro, texto, ponto, aparar/estender, offset, espelhar,
  padrões, relações, construção, escala real 1:1. Fora: "Esboço/Esboço 3D" e "Converter/silhueta/
  interseção" (pedem uma peça 3D).
- Painel do esboço **à esquerda** (o mesmo do WJCAD: definição, opções da ferramenta, seleção,
  relações, cotas), sem o botão "Sair do esboço" (o esboço fica sempre aberto). Atalhos iguais
  (L, R, C, A, S, P, T, D, O, M, V, Delete, Enter/Esc, Ctrl+A/Z/Y) e F enquadra.
- Relações com as entidades e com a **origem** e os eixos (coincidente, horizontal, vertical, paralelo,
  perpendicular, tangente, igual, concêntrico, ponto médio, simétrico, fixo…) e cotas dirigidas: o
  solver é o mesmo, com a indicação sub/totalmente definido.
- Vista só 2D (`Viewport.definir2D`): plano Frontal (XY) de frente, sem girar; caneta desenha, dedo
  e botão do meio arrastam, roda e pinça aproximam. Planos padrão ocultos.

### 2.2 Figuras = regiões fechadas do esboço
- Entidades de construção, pontos soltos e referências ficam de fora.
- As curvas são **cortadas onde se tocam ou se cruzam** (ponta sobre outra curva, cruzamentos de linhas,
  arcos e círculos) e as regiões saem do grafo resultante (face à esquerda). Assim, figuras
  encostadas, figuras sobrepostas (vale a união) e linhas que dividem uma área viram regiões sem
  precisar aparar. Splines e cônicas que se cruzam: aviso para usar Aparar.
- Contorno **dentro de outro = furo** por padrão (profundidade ímpar); a caixa "Furo" na lista troca
  (ex.: peça encaixada de outro material vira sólida, com a massa dela).
- Integrais exatas pelo teorema de Green em cada trecho (linha, arco, arco de elipse, Bézier da spline,
  parábola) com Gauss-Legendre de 8 pontos.
- Cada região guarda nome, furo e massa pela chave das entidades do contorno (`regioes` no arquivo);
  novas regiões ganham "Figura N".

### 2.3 Massa (painel da direita)
- **Massa única (um material)**: densidade ρ (kg/m³, padrão aço 7850) e espessura t (mm) para todas
  as figuras; m = ρ·t·A. O CG coincide com o centroide da área.
- **Massa de cada figura**: massa (kg) informada em cada figura sólida; o CG é a média ponderada pelas
  massas; o centroide da área aparece à parte (✕ no desenho) quando difere.

### 2.4 Resultados
- CG de **cada figura** (símbolo azul com o nome; furo com ✕ vermelho) e do **conjunto** (símbolo preto
  com X; Y), desenhados por cima do esboço. Tocar uma figura na lista destaca o contorno dela.
- Por figura: área líquida, massa, x̄, ȳ.
- Conjunto: massa total, área líquida; **momento de inércia de área** nos eixos pelo centroide (Ix, Iy,
  Ixy, J, principais I₁/I₂ e ângulo θ) e nos eixos da origem; **momento de inércia de massa** pelo CG
  (Ix, Iy, Iz polar; placa fina de massa uniforme em cada figura), em kg·mm² e kg·m².
- **Memória de cálculo** no método das figuras compostas: cada figura entra com o contorno cheio (+)
  e o que está dentro dela recortado (−); colunas A, m, x̄, ȳ, A·x̄ (ou m·x̄), Ix', Iy', dx, dy e eixos
  paralelos; X = ΣA·x̄/ΣA (ou Σm·x̄/Σm) escrito com os números. **Copiar tabela** cola no WJPlan.
- Testes contra as tabelas (b·h³/12, b·h³/36, π·r⁴/4, semicírculo, quarto de círculo, elipse, −b²h²/72,
  placa m(b²+h²)/12), figuras encostadas, linha que divide, círculo sobre a borda (união), furo ↔ sólido.

### 2.5 Arquivo
`.wjcalc` = JSON `{ versao: 2, nome, modulo: "cg2d", cg2d: { esboco, regioes, material } }` (o esboço
no formato do WJCAD). Arquivos da versão 1 (figuras próprias) abrem convertidos em entidades de esboço.
Salvamento automático no aparelho (`wjcalc:documento`), desfazer/refazer, salvar no cofre (Ctrl+S).

## 3. Álgebra, matrizes e física (08/11/2026)

Motor puro `src/calceng/calculadoras.ts` (testado em `teste-calceng.ts` com exemplos resolvidos à mão):
cada calculadora declara os **campos** (número, opção ou matriz redimensionável) e devolve a
**resolução passo a passo** (como no caderno), os resultados em destaque e, quando ajuda, um desenho em
SVG. Tela: campos à esquerda (atualizam ao digitar; vírgula e contas como `2*pi`), resolução no resto da
tela; faixa com Calculadoras, Exemplo (volta aos valores do exemplo) e Copiar resolução (texto). Os
valores de cada calculadora ficam no `.wjcalc` (`calcs[id]`, com `modulo` = calculadora aberta), com
desfazer/refazer. Respostas exatas aparecem também em fração ("2,5 (= 5/2)").

| Calculadora | O que mostra |
|---|---|
| Equação do 1º grau | a·x + b = c·x + d: isolar x, verificação; casos ℝ e ∅ |
| Equação do 2º grau | Δ, Bhaskara, raiz dupla, raízes complexas, soma e produto, forma fatorada, vértice e concavidade, gráfico |
| Sistemas (2 a 6 variáveis) | matriz aumentada, Gauss-Jordan com pivoteamento parcial (operações Lᵢ ← …), SPD/SPI/SI, solução geral no SPI |
| Inequações | 1º grau (inverte o sinal ao dividir por negativo) e 2º grau (estudo do sinal), conjunto solução em intervalos e gráfico com a faixa da solução |
| Matriz 3×3 — Cramer | D por Sarrus com os números, Dx, Dy, Dz, x = Dx/D…; D = 0 → SI ou "use Gauss" |
| Matriz 3×3 — Gauss | escalonamento (troca de linha com pivô zero) e retrossubstituição |
| Multiplicação de matrizes | até 6×6; confere dimensões; cada cᵢⱼ = Σ aᵢₖ·bₖⱼ escrito |
| Leis de Newton | F = m·a (calcula F, m ou a) e peso; resultante de várias forças (componentes, módulo, direção, a = R/m) com diagrama |
| Plano inclinado | P∥, P⊥, N, atrito estático máximo, parado ou em movimento (sentido), a, ângulo crítico; diagrama de forças |
| Força de atrito | plano horizontal, força com ângulo: N = m·g − F·sen θ, estático × cinético, a; diagrama |
| Trabalho | W = F·d·cos θ (+ potência), teorema da energia cinética, trabalho do peso e ΔEp |

## 4. Pendente / ideias
- Figuras de massa pontual e eixo de referência escolhido pelo usuário (hoje: origem e CG).
- Tocar a região no desenho para selecioná-la (hoje: pela lista do painel).
