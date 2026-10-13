// Controle Financeiro: interface. Sem dependências e sem etapa de build.
// Os dados e as regras ficam em dados.js; aqui só se monta a tela.

import { MAX_PARCELAS, abrirBanco, hojeISO, validarBackup } from './dados.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const $ = (seletor, raiz = document) => raiz.querySelector(seletor);

// Todo texto vindo do usuário entra no DOM como nó de texto, nunca como HTML.
function criar(ns, tag, attrs, filhos) {
  const el = ns ? document.createElementNS(ns, tag) : document.createElement(tag);
  for (const [chave, valor] of Object.entries(attrs ?? {})) {
    if (valor === null || valor === undefined || valor === false || chave === 'value') continue;
    if (typeof valor === 'function') el.addEventListener(chave.replace(/^on/, ''), valor);
    else el.setAttribute(chave, valor === true ? '' : valor);
  }
  for (const filho of filhos.flat(Infinity)) {
    if (filho === null || filho === undefined || filho === false) continue;
    el.append(filho);
  }
  // Depois dos filhos: um <select> só aceita valor que já exista entre as opções.
  if (attrs?.value !== undefined && attrs.value !== null) el.value = attrs.value;
  return el;
}
const h = (tag, attrs, ...filhos) => criar(null, tag, attrs, filhos);
const s = (tag, attrs, ...filhos) => criar(SVG_NS, tag, attrs, filhos);

// ---------------------------------------------------------------- formatos

const moeda = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const numero = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const compacto = new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 });
const porcento = new Intl.NumberFormat('pt-BR', { style: 'percent', maximumFractionDigits: 0 });
const fmt = (centavos) => moeda.format(centavos / 100);
const decimal = (centavos) => numero.format(centavos / 100);

// Aceita "1.234,56", "1234,56", "1234.56" e "1234". Devolve centavos ou null.
function lerValor(texto, { negativo = false } = {}) {
  let t = String(texto).replace(/R\$|\s/g, '').replace('−', '-');
  const sinal = t.startsWith('-') ? -1 : 1;
  if (sinal < 0) t = t.slice(1);
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
  else if (!/^\d+\.\d{1,2}$/.test(t)) t = t.replace(/\./g, '');
  const partes = /^(\d+)(?:\.(\d{1,2}))?$/.exec(t);
  if (!partes || (sinal < 0 && !negativo)) return null;
  return sinal * (Number(partes[1]) * 100 + Number((partes[2] ?? '').padEnd(2, '0')));
}

const pad = (n) => String(n).padStart(2, '0');
const isoMes = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
const dataDoMes = (mes) => new Date(Number(mes.slice(0, 4)), Number(mes.slice(5)) - 1, 1);
const nomeMes = (mes, opcoes = { month: 'long', year: 'numeric' }) =>
  dataDoMes(mes).toLocaleDateString('pt-BR', opcoes);
const mesSimples = (mes) => nomeMes(mes, { month: 'long' });
const mesCurto = (mes) => nomeMes(mes, { month: 'short' }).replace('.', '');
const dataBR = (iso) => iso.split('-').reverse().join('/');

function deslocarMes(mes, n) {
  const d = dataDoMes(mes);
  d.setMonth(d.getMonth() + n);
  return isoMes(d);
}

function diasDesde(iso) {
  const [ano, mes, dia] = iso.split('-').map(Number);
  return Math.floor((Date.now() - new Date(ano, mes - 1, dia).getTime()) / 86_400_000);
}

const ROTULO_CONTA = {
  corrente: 'Conta corrente',
  poupanca: 'Poupança',
  carteira: 'Carteira (dinheiro)',
  cartao: 'Cartão de crédito',
  investimento: 'Investimento',
};
const ROTULO_BANDEIRA = {
  visa: 'Visa',
  mastercard: 'Mastercard',
  elo: 'Elo',
  amex: 'American Express',
  hipercard: 'Hipercard',
  outra: 'Outra',
};

// Um cartão é uma conta do tipo "cartao": o saldo negativo é o que está em aberto.
const ehCartao = (c) => c.tipo === 'cartao';
const emAberto = (c) => -c.saldo || 0; // "|| 0" evita o "-R$ 0,00" de um zero negativo
// Só há fatura mês a mês quando o cartão tem os dias de fechamento e de vencimento.
const temFatura = (c) => ehCartao(c) && Boolean(c.dia_fechamento && c.dia_vencimento);
const ROTULO_FATURA = {
  futura: 'Futura',
  aberta: 'Aberta',
  fechada: 'Fechada',
  vencida: 'Vencida',
  paga: 'Paga',
  zerada: 'Sem valor a pagar',
};

// ---------------------------------------------------------------- estado

let banco;
let convite = null; // evento do navegador que permite oferecer "Instalar app"

const estado = {
  mes: isoMes(new Date()),
  contas: [],
  categorias: [],
  ultimaConta: null,
  mesFatura: null, // mês (de vencimento) da fatura em exibição; null = a fatura aberta do cartão
  filtros: { tipo: '', conta_id: '', categoria_id: '', q: '' },
};

function carregarBase() {
  estado.contas = banco.contas();
  estado.categorias = banco.categorias();
}

function aposMudanca() {
  carregarBase();
  renderizar();
  // Pede ao navegador que não descarte estes dados quando faltar espaço no aparelho.
  navigator.storage?.persist?.().catch(() => {});
}

// Preferências pequenas deste aparelho; o app funciona igual se o navegador as recusar.
function lerLocal(chave) {
  try {
    return localStorage.getItem(chave);
  } catch {
    return null;
  }
}

function gravarLocal(chave, valor) {
  try {
    localStorage.setItem(chave, valor);
  } catch { /* sem armazenamento local: segue sem lembrar */ }
}

// ---------------------------------------------------------------- peças de interface

let esperaAviso;
function avisar(mensagem) {
  const el = $('#aviso');
  el.textContent = mensagem;
  el.hidden = false;
  clearTimeout(esperaAviso);
  esperaAviso = setTimeout(() => { el.hidden = true; }, 3500);
}

function baixar(nome, conteudo, tipo) {
  const url = URL.createObjectURL(new Blob([conteudo], { type: tipo }));
  const link = h('a', { href: url, download: nome });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

const dica = $('#dica');

function mostrarDica(nos, x, y) {
  dica.replaceChildren(...nos);
  dica.hidden = false;
  const caixa = dica.getBoundingClientRect();
  let esquerda = x + 14;
  let topo = y + 14;
  if (esquerda + caixa.width > innerWidth - 8) esquerda = x - caixa.width - 14;
  if (topo + caixa.height > innerHeight - 8) topo = y - caixa.height - 14;
  dica.style.left = `${Math.max(8, esquerda)}px`;
  dica.style.top = `${Math.max(8, topo)}px`;
}

function esconderDica() {
  dica.hidden = true;
}

// A mesma dica aparece ao passar o ponteiro, ao tocar e ao focar pelo teclado.
function comDica(el, construir) {
  el.addEventListener('pointermove', (ev) => mostrarDica(construir(), ev.clientX, ev.clientY));
  el.addEventListener('pointerleave', esconderDica);
  el.addEventListener('focus', () => {
    const r = el.getBoundingClientRect();
    mostrarDica(construir(), r.left + r.width / 2, r.top + r.height / 2);
  });
  el.addEventListener('blur', esconderDica);
  return el;
}

const itemDica = (cor, valor, rotulo) => h('div', { class: 'dica-item' },
  cor && h('i', { style: `background:${cor}` }), h('b', {}, valor), h('span', {}, rotulo));

function cartao({ titulo, sub, acoes }, ...corpo) {
  return h('section', { class: 'cartao' },
    h('div', { class: 'cartao-topo' },
      h('div', {}, h('h2', {}, titulo), sub && h('p', { class: 'sub' }, sub)),
      acoes),
    corpo);
}

// colunas: [{ t: 'Título', num: true }]; linhas e rodapé: listas de células.
function tabela(colunas, linhas, rodape) {
  const celulas = (tag, valores) => valores.map((valor, i) =>
    h(tag, { class: colunas[i].num ? 'num' : null }, valor));
  return h('div', { class: 'rolagem' },
    h('table', {},
      h('thead', {}, h('tr', {}, celulas('th', colunas.map((c) => c.t)))),
      h('tbody', {}, linhas.map((linha) => h('tr', {}, celulas('td', linha)))),
      rodape && h('tfoot', {}, h('tr', {}, celulas('td', rodape)))));
}

// Todo gráfico tem uma tabela equivalente, alternada por este botão.
function alternarTabela(grafico, tabelaEl) {
  tabelaEl.hidden = true;
  const botao = h('button', {
    type: 'button',
    class: 'btn pequeno discreto',
    onclick: () => {
      const verTabela = tabelaEl.hidden;
      tabelaEl.hidden = !verTabela;
      grafico.hidden = verTabela;
      botao.textContent = verTabela ? 'Ver gráfico' : 'Ver tabela';
    },
  }, 'Ver tabela');
  return botao;
}

function seletor(opcoes, valor, attrs = {}) {
  const el = h('select', attrs, opcoes.map(([v, rotulo]) => h('option', { value: v }, rotulo)));
  el.value = valor ?? '';
  if (el.selectedIndex < 0) el.selectedIndex = 0;
  return el;
}

// Seletor de conta: com cartões cadastrados, contas e cartões aparecem em grupos separados.
function seletorContas(contas, valor, { vazio, attrs = {} } = {}) {
  const opcoes = (itens) => itens.map((c) => h('option', { value: c.id }, c.nome));
  const cartoes = contas.filter(ehCartao);
  const el = h('select', attrs,
    vazio && h('option', { value: '' }, vazio),
    cartoes.length
      ? [h('optgroup', { label: 'Contas' }, opcoes(contas.filter((c) => !ehCartao(c)))),
        h('optgroup', { label: 'Cartões de crédito' }, opcoes(cartoes))]
      : opcoes(contas));
  el.value = valor ?? '';
  if (el.selectedIndex < 0) el.selectedIndex = 0;
  return el;
}

const campo = (rotulo, controle) => h('label', { class: 'campo' }, h('span', {}, rotulo), controle);

// excluirTudo = { rotulo, pergunta, acao }: segunda exclusão, mais ampla (todas as parcelas).
function abrirDialogo({ titulo, corpo, aoSalvar, aoExcluir, excluirTudo }) {
  const dialogo = $('#dialogo');
  const erro = h('p', { class: 'form-erro', role: 'alert', hidden: true });
  const tentar = async (acao) => {
    erro.hidden = true;
    try {
      await acao();
      dialogo.close();
      aposMudanca();
    } catch (falha) {
      erro.textContent = falha.message;
      erro.hidden = false;
    }
  };
  dialogo.replaceChildren(h('form', {
    method: 'dialog',
    novalidate: true,
    onsubmit: (ev) => {
      ev.preventDefault();
      tentar(aoSalvar);
    },
  },
    h('h2', {}, titulo),
    corpo,
    erro,
    h('div', { class: 'form-acoes' },
      aoExcluir && h('button', {
        type: 'button',
        class: 'btn perigo',
        onclick: () => { if (confirm('Excluir definitivamente?')) tentar(aoExcluir); },
      }, excluirTudo ? 'Excluir esta' : 'Excluir'),
      excluirTudo && h('button', {
        type: 'button',
        class: 'btn perigo',
        onclick: () => { if (confirm(excluirTudo.pergunta)) tentar(excluirTudo.acao); },
      }, excluirTudo.rotulo),
      h('span', { class: 'espaco' }),
      h('button', { type: 'button', class: 'btn', onclick: () => dialogo.close() }, 'Cancelar'),
      h('button', { type: 'submit', class: 'btn primario' }, 'Salvar'))));
  dialogo.showModal();
}

// ---------------------------------------------------------------- gráficos

const desenhos = new WeakMap();
const aoRedimensionar = new ResizeObserver((entradas) => {
  for (const entrada of entradas) desenhos.get(entrada.target)?.();
});

function escalaLimpa(maximo, divisoes = 4) {
  if (maximo <= 0) return { topo: 1000, passo: 250 };
  const bruto = maximo / divisoes;
  const potencia = 10 ** Math.floor(Math.log10(bruto));
  const passo = [1, 2, 2.5, 5, 10].find((m) => m * potencia >= bruto) * potencia;
  return { topo: Math.ceil(maximo / passo) * passo, passo };
}

// Coluna com 4px de arredondamento na ponta e base reta.
function caminhoColuna(x, yTopo, largura, yBase) {
  const raio = Math.min(4, yBase - yTopo, largura / 2);
  return `M${x},${yBase}V${yTopo + raio}Q${x},${yTopo} ${x + raio},${yTopo}`
    + `H${x + largura - raio}Q${x + largura},${yTopo} ${x + largura},${yTopo + raio}V${yBase}Z`;
}

function graficoHistorico(historico, mesAtual) {
  const series = [
    { chave: 'receitas', rotulo: 'Receitas', cor: 'var(--serie-1)' },
    { chave: 'despesas', rotulo: 'Despesas', cor: 'var(--serie-2)' },
  ];
  const caixa = h('div', { class: 'grafico' });

  desenhos.set(caixa, () => {
    const largura = caixa.clientWidth;
    if (!largura) return;
    const altura = 240;
    const margem = { topo: 12, direita: 8, base: 28, esquerda: 54 };
    const plotLargura = largura - margem.esquerda - margem.direita;
    const plotAltura = altura - margem.topo - margem.base;
    const base = margem.topo + plotAltura;
    const maximo = Math.max(...historico.flatMap((p) => [p.receitas, p.despesas])) / 100;
    const { topo, passo } = escalaLimpa(maximo);
    const y = (centavos) => base - (centavos / 100 / topo) * plotAltura;
    const banda = plotLargura / historico.length;
    const larguraColuna = Math.max(4, Math.min(24, (banda * 0.6 - 2) / 2));

    const grade = [];
    for (let v = 0; v <= topo + passo / 2; v += passo) {
      const yLinha = Math.round(y(v * 100)) + 0.5;
      grade.push(
        s('line', {
          class: v === 0 ? 'eixo-linha' : 'grade-linha',
          x1: margem.esquerda, x2: largura - margem.direita, y1: yLinha, y2: yLinha,
        }),
        s('text', { x: margem.esquerda - 8, y: yLinha, 'text-anchor': 'end', 'dominant-baseline': 'middle' },
          compacto.format(v)));
    }

    const meses = historico.map((ponto, i) => {
      const inicio = margem.esquerda + banda * i;
      const centro = inicio + banda / 2;
      const alvo = comDica(
        s('rect', {
          class: 'banda', tabindex: '0', role: 'img', rx: 6,
          x: inicio + 2, y: margem.topo, width: banda - 4, height: plotAltura,
          'aria-label': `${nomeMes(ponto.mes)}: receitas ${fmt(ponto.receitas)}, despesas ${fmt(ponto.despesas)}`,
        }),
        () => [
          h('div', { class: 'dica-titulo' }, nomeMes(ponto.mes)),
          ...series.map((serie) => itemDica(serie.cor, fmt(ponto[serie.chave]), serie.rotulo)),
        ]);
      // 2px de respiro entre as duas colunas do mês.
      const colunas = series.map((serie, j) => ponto[serie.chave] > 0 && s('path', {
        class: 'coluna',
        fill: serie.cor,
        d: caminhoColuna(
          j === 0 ? centro - 1 - larguraColuna : centro + 1,
          Math.min(y(ponto[serie.chave]), base - 1), larguraColuna, base),
      }));
      const rotulo = s('text', {
        class: ponto.mes === mesAtual ? 'atual' : null,
        x: centro, y: altura - 8, 'text-anchor': 'middle',
      }, mesCurto(ponto.mes));
      return [alvo, colunas, rotulo];
    });

    caixa.replaceChildren(s('svg', {
      width: largura, height: altura, role: 'group', 'aria-label': 'Receitas e despesas por mês',
    }, grade, meses));
  });

  return h('div', {},
    h('div', { class: 'legenda' },
      series.map((serie) => h('span', {}, h('i', { style: `background:${serie.cor}` }), serie.rotulo))),
    caixa);
}

// Barras horizontais de uma série só: uma cor, valor escrito na ponta.
function graficoCategorias(itens, total) {
  const maior = Math.max(...itens.map((item) => item.total));
  return h('div', { class: 'barras' }, itens.map((item) => comDica(
    h('div', { class: 'barra-linha', tabindex: '0', style: `--fracao:${item.total / maior}` },
      h('span', { class: 'barra-nome' }, item.nome),
      h('span', { class: 'barra-area' },
        h('span', { class: 'barra-marca' }),
        h('span', { class: 'barra-valor' }, fmt(item.total)))),
    () => [
      h('div', { class: 'dica-titulo' }, item.nome),
      itemDica(null, fmt(item.total), `${porcento.format(item.total / total)} das despesas`),
    ])));
}

// Barra de uso de um limite (orçamento ou cartão), com o estado escrito ao lado do ícone:
// a cor nunca é o único sinal. textos = { ok, alerta, critico }.
function barraDeUso(rotulo, usado, limite, textos) {
  const fracao = Math.max(usado, 0) / limite;
  const nivel = fracao > 1 ? 'critico' : fracao >= 0.8 ? 'alerta' : 'ok';
  const icone = { ok: '✓', alerta: '!', critico: '✕' }[nivel];
  return { nivel, nos: [
    h('div', {
      class: 'medidor', role: 'meter', 'aria-label': rotulo,
      'aria-valuemin': 0, 'aria-valuemax': limite / 100, 'aria-valuenow': usado / 100,
    }, h('span', { style: `width:${Math.min(fracao, 1) * 100}%` })),
    h('div', { class: `estado ${nivel}` }, h('i', { 'aria-hidden': 'true' }, icone), textos[nivel]),
  ] };
}

function medidor(o) {
  const resto = o.limite - o.gasto;
  const { nivel, nos } = barraDeUso(`Gasto em ${o.nome}`, o.gasto, o.limite, {
    ok: `Dentro do limite · restam ${fmt(resto)}`,
    alerta: resto ? `Perto do limite · restam ${fmt(resto)}` : 'Limite atingido',
    critico: `Limite ultrapassado em ${fmt(-resto)}`,
  });
  return h('div', { class: nivel },
    h('div', { class: 'medidor-topo' },
      h('strong', {}, o.nome),
      h('span', {}, `${fmt(o.gasto)} de ${fmt(o.limite)}`)),
    nos);
}

// ---------------------------------------------------------------- painel

function indicador({ rotulo, valor, nota, tom, heroi }) {
  return h('section', { class: `cartao indicador${heroi ? ' heroi' : ''}` },
    h('span', { class: 'rotulo' }, rotulo),
    h('span', { class: 'valor' }, valor),
    nota && h('span', { class: `nota ${tom ?? ''}` }, nota));
}

function variacao(atual, anterior, mesAnterior, coisa, subirEhBom) {
  const mes = mesSimples(mesAnterior);
  if (!anterior) return { nota: `Sem ${coisa} em ${mes}` };
  const delta = (atual - anterior) / anterior;
  if (Math.abs(delta) < 0.005) return { nota: `Igual a ${mes}` };
  return {
    nota: `${delta > 0 ? '▲' : '▼'} ${porcento.format(Math.abs(delta))} em relação a ${mes}`,
    tom: (delta > 0) === subirEhBom ? 'bom' : 'ruim',
  };
}

function boasVindas() {
  return h('section', { class: 'cartao boas-vindas' },
    h('h2', {}, 'Comece por aqui'),
    h('p', {}, 'Confira suas contas e informe o saldo que cada uma tem hoje. Depois registre '
      + 'receitas e despesas: o painel passa a mostrar para onde o dinheiro está indo.'),
    h('p', {}, 'Tudo fica guardado só neste aparelho. Já usava o app em outro lugar? Restaure um backup.'),
    h('div', { class: 'campo-linha quebra' },
      h('button', { type: 'button', class: 'btn primario', onclick: () => dialogoLancamento() },
        'Registrar primeiro lançamento'),
      h('a', { class: 'btn', href: '#contas' }, 'Ajustar contas'),
      h('a', { class: 'btn', href: '#ajustes' }, 'Restaurar backup')));
}

// Como os dados só existem neste aparelho, o painel lembra do backup de tempos em tempos.
function lembreteBackup(totalLancamentos) {
  const ultimo = lerLocal('ultimo-backup');
  let texto = null;
  if (!ultimo && totalLancamentos >= 10) texto = 'Você ainda não fez backup dos dados deste aparelho.';
  else if (ultimo && diasDesde(ultimo) > 30) texto = `Seu último backup foi há ${diasDesde(ultimo)} dias.`;
  return texto && h('section', { class: 'cartao lembrete' },
    h('span', {}, texto), h('a', { class: 'btn pequeno', href: '#ajustes' }, 'Fazer backup'));
}

// Linha do painel sob o nome do cartão: a fatura mais antiga que já fechou e falta
// pagar ou, não havendo nenhuma, a que está aberta.
function proximaFatura(c) {
  if (!temFatura(c)) return null;
  const { aberta, fechadas } = banco.faturasDoCartao(c.id);
  const f = fechadas[0] ?? aberta;
  const quando = `${f.estado === 'vencida' ? 'venceu' : 'vence'} em ${dataBR(f.vencimento).slice(0, 5)}`;
  return h('div', { class: 'sub' }, `Fatura de ${mesSimples(f.mes)}: ${fmt(f.restante)} · ${quando}`);
}

function viewPainel() {
  const r = banco.resumo(estado.mes);
  if (!r.total_lancamentos) return [boasVindas()];

  const mes = mesSimples(estado.mes);
  const anterior = r.historico[r.historico.length - 2];
  const resultado = r.receitas - r.despesas;
  const ativas = estado.contas.filter((c) => !c.arquivada && !ehCartao(c));
  const cartoes = estado.contas.filter((c) => !c.arquivada && ehCartao(c));

  let notaResultado = { nota: 'Receitas menos despesas' };
  if (resultado < 0) notaResultado = { nota: 'Despesas acima das receitas', tom: 'ruim' };
  else if (resultado > 0 && r.receitas > 0) {
    notaResultado = { nota: `Sobraram ${porcento.format(resultado / r.receitas)} das receitas`, tom: 'bom' };
  }

  const indicadores = h('div', { class: 'indicadores' },
    indicador({
      rotulo: 'Saldo atual',
      valor: fmt(r.saldo_total),
      nota: `Soma de ${ativas.length} ${ativas.length === 1 ? 'conta' : 'contas'}, com lançamentos até hoje`,
      heroi: true,
    }),
    indicador({
      rotulo: `Receitas em ${mes}`,
      valor: fmt(r.receitas),
      ...variacao(r.receitas, anterior.receitas, anterior.mes, 'receitas', true),
    }),
    indicador({
      rotulo: `Despesas em ${mes}`,
      valor: fmt(r.despesas),
      ...variacao(r.despesas, anterior.despesas, anterior.mes, 'despesas', false),
    }),
    indicador({ rotulo: `Resultado de ${mes}`, valor: fmt(resultado), ...notaResultado }));

  const historico = graficoHistorico(r.historico, estado.mes);
  const tabelaHistorico = tabela(
    [{ t: 'Mês' }, { t: 'Receitas', num: true }, { t: 'Despesas', num: true }, { t: 'Resultado', num: true }],
    r.historico.map((p) => [nomeMes(p.mes), fmt(p.receitas), fmt(p.despesas), fmt(p.receitas - p.despesas)]));
  const cartaoHistorico = cartao(
    { titulo: 'Receitas e despesas', sub: 'Últimos 6 meses, em reais', acoes: alternarTabela(historico, tabelaHistorico) },
    historico, tabelaHistorico);

  let cartaoCategorias;
  if (r.por_categoria.length) {
    // Acima de 8 categorias, as menores viram "Outras" para a lista continuar legível.
    let itens = r.por_categoria;
    if (itens.length > 8) {
      const resto = itens.slice(7);
      itens = [...itens.slice(0, 7), {
        nome: `Outras (${resto.length} categorias)`,
        total: resto.reduce((soma, item) => soma + item.total, 0),
      }];
    }
    const barras = graficoCategorias(itens, r.despesas);
    const tabelaCategorias = tabela(
      [{ t: 'Categoria' }, { t: 'Valor', num: true }, { t: 'Parte', num: true }],
      r.por_categoria.map((c) => [c.nome, fmt(c.total), porcento.format(c.total / r.despesas)]),
      ['Total', fmt(r.despesas), '100%']);
    cartaoCategorias = cartao(
      { titulo: 'Despesas por categoria', sub: nomeMes(estado.mes), acoes: alternarTabela(barras, tabelaCategorias) },
      barras, tabelaCategorias);
  } else {
    cartaoCategorias = cartao({ titulo: 'Despesas por categoria', sub: nomeMes(estado.mes) },
      h('p', { class: 'vazio' }, `Nenhuma despesa em ${nomeMes(estado.mes)}.`));
  }

  const orcamentos = [...r.orcamentos].sort((a, b) => b.gasto / b.limite - a.gasto / a.limite);
  const verOrcamento = h('a', { class: 'btn pequeno discreto', href: '#orcamento' },
    orcamentos.length ? 'Ver tudo' : 'Definir limites');
  const cartaoOrcamento = cartao({ titulo: 'Orçamento do mês', sub: nomeMes(estado.mes), acoes: verOrcamento },
    orcamentos.length
      ? h('div', { class: 'medidores' }, orcamentos.slice(0, 4).map(medidor))
      : h('p', { class: 'vazio' }, 'Defina um limite mensal por categoria para acompanhar seus gastos.'));

  const cartaoContas = cartao(
    {
      titulo: cartoes.length ? 'Contas e cartões' : 'Contas',
      sub: 'Saldo até hoje',
      acoes: h('a', { class: 'btn pequeno discreto', href: '#contas' }, 'Gerenciar'),
    },
    tabela([{ t: 'Conta' }, { t: 'Saldo', num: true }],
      ativas.map((c) => [c.nome, fmt(c.saldo)]),
      ['Total', fmt(r.saldo_total)]),
    cartoes.length > 0 && h('div', { class: 'bloco-seguinte' },
      tabela([{ t: 'Cartão de crédito' }, { t: 'Em aberto', num: true }],
        cartoes.map((c) => [[c.nome, proximaFatura(c)], fmt(emAberto(c))]),
        ['Total', fmt(r.cartoes_em_aberto || 0)])));

  return [
    lembreteBackup(r.total_lancamentos),
    indicadores,
    h('div', { class: 'grade-2' }, cartaoHistorico, cartaoCategorias),
    h('div', { class: 'grade-2' }, cartaoOrcamento, cartaoContas),
  ];
}

// ---------------------------------------------------------------- lançamentos

function valorComSinal(l) {
  if (l.tipo === 'receita') return `+ ${fmt(l.valor)}`;
  if (l.tipo === 'despesa') return `− ${fmt(l.valor)}`;
  return fmt(l.valor);
}

// Marcas ao lado da descrição: a parcela ("2/3") e "previsto" para data futura.
function etiquetas(l, hoje) {
  return [
    l.parcela_total && h('span', {
      class: 'etiqueta', title: `Parcela ${l.parcela_numero} de ${l.parcela_total}`,
    }, `${l.parcela_numero}/${l.parcela_total}`),
    l.data > hoje && h('span', { class: 'etiqueta' }, 'previsto'),
  ];
}

function tabelaLancamentos(lista) {
  if (!lista.length) {
    return [h('p', { class: 'vazio' }, `Nenhum lançamento encontrado em ${nomeMes(estado.mes)}.`)];
  }
  const hoje = hojeISO();
  const soma = (tipo) => lista.reduce((total, l) => total + (l.tipo === tipo ? l.valor : 0), 0);
  const receitas = soma('receita');
  const despesas = soma('despesa');
  const tomValor = { receita: 'positivo', despesa: '', transferencia: 'fraco' };

  return [
    h('div', { class: 'totais' },
      h('span', {}, `${lista.length} ${lista.length === 1 ? 'lançamento' : 'lançamentos'}`),
      h('span', {}, 'Receitas ', h('b', {}, fmt(receitas))),
      h('span', {}, 'Despesas ', h('b', {}, fmt(despesas))),
      h('span', {}, 'Resultado ', h('b', {}, fmt(receitas - despesas)))),
    h('div', { class: 'rolagem' },
      h('table', {},
        h('thead', {}, h('tr', {},
          h('th', {}, 'Data'), h('th', {}, 'Descrição'),
          h('th', { class: 'larga' }, 'Categoria'), h('th', { class: 'larga' }, 'Conta'),
          h('th', { class: 'num' }, 'Valor'), h('th', { class: 'larga', 'aria-label': 'Ações' }))),
        h('tbody', {}, lista.map((l) => {
          const transferencia = l.tipo === 'transferencia';
          const categoria = transferencia ? 'Transferência' : l.categoria ?? 'Sem categoria';
          const conta = transferencia ? `${l.conta} → ${l.conta_destino}` : l.conta;
          // A linha inteira abre a edição: no celular não há espaço para a coluna do botão.
          return h('tr', { class: 'clicavel', onclick: () => dialogoLancamento(l) },
            // O ano some em telas estreitas: o mês em exibição já o informa.
            h('td', { class: 'data' }, dataBR(l.data).slice(0, 5), h('span', { class: 'larga' }, `/${l.data.slice(0, 4)}`)),
            // Em telas estreitas as colunas de categoria e conta viram esta segunda linha.
            h('td', {}, l.descricao, etiquetas(l, hoje),
              h('div', { class: 'detalhe' }, `${categoria} · ${conta}`)),
            h('td', { class: `larga ${transferencia || !l.categoria ? 'fraco' : ''}` }, categoria),
            h('td', { class: 'larga' }, conta),
            h('td', { class: `num ${tomValor[l.tipo]}` }, valorComSinal(l)),
            h('td', { class: 'acoes larga' },
              h('button', { type: 'button', class: 'btn pequeno discreto', 'aria-label': `Editar ${l.descricao}` },
                'Editar')));
        })))),
  ];
}

function viewLancamentos() {
  const f = estado.filtros;
  const corpo = h('div', {});
  const filtrosAtuais = () => ({
    mes: estado.mes,
    tipo: f.tipo,
    conta_id: Number(f.conta_id) || null,
    categoria_id: Number(f.categoria_id) || null,
    q: f.q,
  });
  const atualizar = () => corpo.replaceChildren(...tabelaLancamentos(banco.lancamentos(filtrosAtuais())));

  const filtro = (chave, rotulo, opcoes) => {
    const el = h('select', {
      'aria-label': rotulo,
      onchange: () => { f[chave] = el.value; atualizar(); },
    }, opcoes);
    el.value = f[chave];
    // O item filtrado pode ter sido excluído desde a última visita.
    if (el.selectedIndex < 0) { el.selectedIndex = 0; f[chave] = ''; }
    return el;
  };
  const opcao = (valor, rotulo) => h('option', { value: valor }, rotulo);
  const filtroConta = seletorContas(estado.contas, f.conta_id, {
    vazio: estado.contas.some(ehCartao) ? 'Todas as contas e cartões' : 'Todas as contas',
    attrs: { 'aria-label': 'Conta', onchange: () => { f.conta_id = filtroConta.value; atualizar(); } },
  });
  f.conta_id = filtroConta.value; // a conta filtrada pode ter sido excluída desde a última visita

  const filtros = h('section', { class: 'cartao filtros' },
    h('input', {
      type: 'search', placeholder: 'Buscar na descrição', 'aria-label': 'Buscar na descrição', value: f.q,
      oninput: (ev) => { f.q = ev.target.value; atualizar(); },
    }),
    filtro('tipo', 'Tipo', [
      opcao('', 'Todos os tipos'), opcao('despesa', 'Despesas'),
      opcao('receita', 'Receitas'), opcao('transferencia', 'Transferências'),
    ]),
    filtroConta,
    filtro('categoria_id', 'Categoria', [
      opcao('', 'Todas as categorias'),
      ...[['despesa', 'Despesas'], ['receita', 'Receitas']].map(([tipo, rotulo]) =>
        h('optgroup', { label: rotulo },
          estado.categorias.filter((c) => c.tipo === tipo).map((c) => opcao(c.id, c.nome)))),
    ]),
    h('button', {
      type: 'button', class: 'btn',
      onclick: () => baixar(`lancamentos-${estado.mes}.csv`, banco.csv(filtrosAtuais()), 'text/csv;charset=utf-8'),
    }, 'Exportar CSV'));

  atualizar();
  return [filtros, h('section', { class: 'cartao' }, corpo)];
}

// l: lançamento existente, para editar. modelo: valores iniciais de um lançamento novo
// (é assim que "Pagar fatura" abre o formulário já preenchido).
function dialogoLancamento(l, modelo = {}) {
  const contas = estado.contas.filter((c) =>
    !c.arquivada || c.id === l?.conta_id || c.id === l?.conta_destino_id);
  if (!contas.length) {
    avisar('Cadastre uma conta antes de registrar lançamentos.');
    location.hash = '#contas';
    return;
  }
  const inicial = l ?? modelo;
  const temCartao = contas.some(ehCartao);
  const dataPadrao = estado.mes === isoMes(new Date()) ? hojeISO() : `${estado.mes}-01`;
  let tipo = inicial.tipo ?? 'despesa';

  const valor = h('input', {
    type: 'text', inputmode: 'decimal', placeholder: '0,00', autocomplete: 'off', autofocus: true,
    value: inicial.valor ? decimal(inicial.valor) : '',
    oninput: () => atualizarParcelas(),
  });
  const data = h('input', { type: 'date', value: l?.data ?? dataPadrao });
  const descricao = h('input', { type: 'text', maxlength: 200, autocomplete: 'off', value: inicial.descricao ?? '' });
  const conta = seletorContas(contas, inicial.conta_id ?? estado.ultimaConta);
  const destino = seletorContas(contas,
    inicial.conta_destino_id ?? contas.find((c) => String(c.id) !== conta.value)?.id);
  const categoria = h('select', {});
  const rotuloConta = h('span', {});
  const campoDestino = campo(temCartao ? 'Conta ou cartão de destino' : 'Conta de destino', destino);
  const campoCategoria = campo('Categoria', categoria);

  // Parcelamento: só ao incluir uma despesa em cartão de crédito. O valor digitado é o
  // total da compra; o app o divide em uma parcela por mês a partir da data.
  const parcelas = seletor(
    [[1, 'À vista'], ...Array.from({ length: MAX_PARCELAS - 1 }, (_, i) => [i + 2, `${i + 2}x`])], 1,
    { onchange: () => atualizarParcelas() });
  const previa = h('p', { class: 'sub' });
  const campoParcelas = h('div', { class: 'campo' }, campo('Parcelas', parcelas), previa);
  const parcelavel = () => !l && tipo === 'despesa'
    && contas.some((c) => ehCartao(c) && String(c.id) === conta.value);
  const numeroDeParcelas = () => (parcelavel() ? Number(parcelas.value) : 1);
  const atualizarParcelas = () => {
    campoParcelas.hidden = !parcelavel();
    const n = numeroDeParcelas();
    const total = lerValor(valor.value);
    if (n === 1) previa.textContent = '';
    else if (!total || total < n) previa.textContent = 'Informe em "Valor" o total da compra.';
    else {
      const base = Math.floor(total / n);
      const primeira = total - base * (n - 1);
      previa.textContent = (primeira === base
        ? `${n} parcelas de ${fmt(base)}`
        : `1 parcela de ${fmt(primeira)} e ${n - 1} de ${fmt(base)}`) + ', uma por mês a partir da data da compra.';
    }
  };
  conta.addEventListener('change', atualizarParcelas);

  const aplicarTipo = () => {
    const transferencia = tipo === 'transferencia';
    campoDestino.hidden = !transferencia;
    campoCategoria.hidden = transferencia;
    rotuloConta.textContent = transferencia ? 'Conta de origem' : temCartao ? 'Conta ou cartão' : 'Conta';
    categoria.replaceChildren(
      h('option', { value: '' }, 'Sem categoria'),
      ...estado.categorias.filter((c) => c.tipo === tipo).map((c) => h('option', { value: c.id }, c.nome)));
    categoria.value = l?.tipo === tipo && l.categoria_id ? l.categoria_id : '';
    atualizarParcelas();
  };
  aplicarTipo();

  const segmentos = h('div', { class: 'segmentos', role: 'radiogroup', 'aria-label': 'Tipo de lançamento' },
    [['despesa', 'Despesa'], ['receita', 'Receita'], ['transferencia', 'Transferência']].map(([v, rotulo]) =>
      h('label', {},
        h('input', { type: 'radio', name: 'tipo', checked: v === tipo, onchange: () => { tipo = v; aplicarTipo(); } }),
        h('span', {}, rotulo))));

  abrirDialogo({
    titulo: l ? 'Editar lançamento' : 'Novo lançamento',
    corpo: [
      segmentos,
      h('div', { class: 'form-dupla' }, campo('Valor (R$)', valor), campo('Data', data)),
      campo('Descrição', descricao),
      h('label', { class: 'campo' }, rotuloConta, conta),
      campoParcelas,
      campoDestino,
      campoCategoria,
      l?.parcela_total && h('p', { class: 'sub' },
        `Parcela ${l.parcela_numero} de ${l.parcela_total} de uma compra parcelada. `
        + 'O que você alterar aqui vale só para esta parcela.'),
    ],
    aoSalvar: async () => {
      const centavos = lerValor(valor.value);
      if (!centavos) throw new Error('Informe um valor maior que zero, por exemplo 49,90.');
      const transferencia = tipo === 'transferencia';
      const vezes = numeroDeParcelas();
      const corpo = {
        tipo,
        data: data.value,
        descricao: descricao.value,
        valor: centavos,
        conta_id: Number(conta.value),
        conta_destino_id: transferencia ? Number(destino.value) : null,
        categoria_id: !transferencia && categoria.value ? Number(categoria.value) : null,
        parcelas: vezes,
      };
      await banco.salvarLancamento(corpo, l?.id);
      estado.ultimaConta = corpo.conta_id;
      const mes = corpo.data.slice(0, 7);
      if (vezes > 1) {
        avisar(`Compra lançada em ${vezes} parcelas, de ${nomeMes(mes)} a ${nomeMes(deslocarMes(mes, vezes - 1))}.`);
      } else {
        avisar(mes === estado.mes ? 'Lançamento salvo.' : `Lançamento salvo em ${nomeMes(mes)}.`);
      }
    },
    aoExcluir: l && (async () => {
      await banco.excluirLancamento(l.id);
      avisar(l.parcela_total ? 'Parcela excluída.' : 'Lançamento excluído.');
    }),
    excluirTudo: l?.parcela_grupo && {
      rotulo: 'Excluir todas as parcelas',
      pergunta: 'Excluir todas as parcelas desta compra, inclusive as de outros meses?',
      acao: async () => {
        const quantas = await banco.excluirParcelas(l.parcela_grupo);
        avisar(`${quantas} ${quantas === 1 ? 'parcela excluída' : 'parcelas excluídas'}.`);
      },
    },
  });
}

// ---------------------------------------------------------------- orçamento

function viewOrcamento() {
  const itens = banco.orcamentos(estado.mes);
  if (!itens.length) {
    return [h('section', { class: 'cartao vazio' }, 'Cadastre categorias de despesa para definir limites.')];
  }
  const mes = mesSimples(estado.mes);
  const totais = h('div', { class: 'totais' });
  const pintarTotais = () => {
    const comLimite = itens.filter((o) => o.limite);
    const orcado = comLimite.reduce((soma, o) => soma + o.limite, 0);
    const gasto = comLimite.reduce((soma, o) => soma + o.gasto, 0);
    totais.replaceChildren(
      h('span', {}, 'Orçado ', h('b', {}, fmt(orcado))),
      h('span', {}, 'Gasto ', h('b', {}, fmt(gasto))),
      h('span', {}, orcado >= gasto ? 'Disponível ' : 'Excedido ', h('b', {}, fmt(Math.abs(orcado - gasto)))));
  };
  pintarTotais();

  const linha = (o) => {
    const info = h('div', {});
    const pintar = () => info.replaceChildren(o.limite ? medidor(o) : h('div', {},
      h('strong', {}, o.nome),
      h('p', { class: 'sub' }, o.gasto ? `${fmt(o.gasto)} em ${mes}, sem limite definido` : 'Sem limite definido')));
    pintar();
    // Só a linha alterada é repintada, para o foco seguir pelos campos com Tab.
    const entrada = h('input', {
      type: 'text', inputmode: 'decimal', placeholder: 'Sem limite', autocomplete: 'off',
      'aria-label': `Limite mensal de ${o.nome}, em reais`,
      value: o.limite ? decimal(o.limite) : '',
      onchange: async () => {
        const texto = entrada.value.trim();
        const limite = texto ? lerValor(texto) : null;
        if (texto && !limite) {
          avisar('Limite inválido. Use um valor como 600,00.');
          return;
        }
        try {
          await banco.definirOrcamento(o.categoria_id, estado.mes, limite);
          o.limite = limite;
          entrada.value = limite ? decimal(limite) : '';
          pintar();
          pintarTotais();
        } catch (erro) {
          avisar(erro.message);
        }
      },
    });
    return h('div', { class: 'orcamento-linha' }, info,
      h('div', { class: 'campo-linha' }, h('span', { class: 'sub', 'aria-hidden': 'true' }, 'Limite R$'), entrada));
  };

  return [cartao(
    {
      titulo: 'Limites mensais por categoria',
      sub: `Limites e gastos de ${nomeMes(estado.mes)}. Um limite alterado aqui vale deste mês em diante; `
        + 'os meses anteriores não mudam.',
    },
    totais, h('div', {}, itens.map(linha)))];
}

// ---------------------------------------------------------------- contas

function secaoContas() {
  const contas = estado.contas.filter((c) => !ehCartao(c));
  const ativas = contas.filter((c) => !c.arquivada);
  const nova = h('button', { type: 'button', class: 'btn pequeno', onclick: () => dialogoConta() }, '+ Nova conta');
  const linhas = contas.map((c) => {
    const tipo = ROTULO_CONTA[c.tipo] ?? c.tipo;
    const referencia = [c.agencia && `Ag. ${c.agencia}`, c.numero && `Conta ${c.numero}`].filter(Boolean).join(' · ');
    return h('tr', { class: `clicavel ${c.arquivada ? 'fraco' : ''}`, onclick: () => dialogoConta(c) },
      h('td', {}, c.nome, c.arquivada ? h('span', { class: 'etiqueta' }, 'arquivada') : null,
        referencia && h('div', { class: 'sub' }, referencia),
        // Em telas estreitas as colunas de banco, tipo e saldo inicial viram esta linha.
        h('div', { class: 'detalhe' }, [c.banco, tipo, `inicial ${fmt(c.saldo_inicial)}`].filter(Boolean).join(' · '))),
      h('td', { class: `larga ${c.banco ? '' : 'fraco'}` }, c.banco || '—'),
      h('td', { class: 'larga' }, tipo),
      h('td', { class: 'num larga' }, fmt(c.saldo_inicial)),
      h('td', { class: 'num' }, fmt(c.saldo)),
      h('td', { class: 'acoes larga' },
        h('button', { type: 'button', class: 'btn pequeno discreto', 'aria-label': `Editar ${c.nome}` }, 'Editar')));
  });

  return cartao(
    { titulo: 'Contas bancárias', sub: 'O saldo atual soma o saldo inicial aos lançamentos com data até hoje.', acoes: nova },
    contas.length
      ? h('div', { class: 'rolagem' }, h('table', {},
        h('thead', {}, h('tr', {},
          h('th', {}, 'Conta'), h('th', { class: 'larga' }, 'Banco'), h('th', { class: 'larga' }, 'Tipo'),
          h('th', { class: 'num larga' }, 'Saldo inicial'), h('th', { class: 'num' }, 'Saldo atual'),
          h('th', { class: 'larga', 'aria-label': 'Ações' }))),
        h('tbody', {}, linhas),
        h('tfoot', {}, h('tr', {},
          h('td', {}, 'Total das contas ativas'),
          h('td', { class: 'larga' }), h('td', { class: 'larga' }), h('td', { class: 'larga' }),
          h('td', { class: 'num' }, fmt(ativas.reduce((soma, c) => soma + c.saldo, 0))),
          h('td', { class: 'larga' })))))
      : h('p', { class: 'vazio' }, 'Nenhuma conta cadastrada.'));
}

// "Pagar fatura" é uma transferência da conta de pagamento para o cartão, já preenchida.
function pagarFatura(c, valor, mes) {
  const origem = c.conta_pagamento_id ?? estado.contas.find((x) => !ehCartao(x) && !x.arquivada)?.id;
  dialogoLancamento(null, {
    tipo: 'transferencia',
    conta_id: origem,
    conta_destino_id: c.id,
    valor,
    descricao: `Pagamento da fatura ${c.nome}${mes ? ` (${nomeMes(mes)})` : ''}`,
  });
}

// Situação da fatura. As que pedem atenção levam ícone e cor; a palavra está sempre lá.
function seloFatura(situacao) {
  const nivel = { paga: 'bom', fechada: 'alerta', vencida: 'critico' }[situacao];
  if (!nivel) return h('span', { class: 'etiqueta solta' }, ROTULO_FATURA[situacao]);
  return h('span', { class: `estado selo ${nivel}` },
    h('i', { 'aria-hidden': 'true' }, { bom: '✓', alerta: '!', critico: '✕' }[nivel]), ROTULO_FATURA[situacao]);
}

// Uma fatura na lista do cartão; o nome leva à tela da fatura daquele mês.
function linhaFatura(c, f) {
  const quando = f.estado === 'aberta'
    ? `fecha em ${dataBR(f.fechamento)} · vence em ${dataBR(f.vencimento)}`
    : `${f.estado === 'vencida' ? 'venceu' : 'vence'} em ${dataBR(f.vencimento)}`;
  return h('div', { class: 'fatura-linha' },
    seloFatura(f.estado),
    h('a', { href: `#fatura/${c.id}`, onclick: () => { estado.mesFatura = f.mes; } }, `Fatura de ${nomeMes(f.mes)}`),
    h('span', { class: 'sub' }, quando),
    h('b', {}, fmt(f.restante)));
}

function itemCartao(c) {
  const aberto = emAberto(c);
  // O limite é ocupado pelo que já está em aberto mais o que ainda vai vencer (parcelas).
  const ocupado = -c.saldo_previsto || 0;
  const aVencer = ocupado - aberto;
  const faturas = temFatura(c) ? banco.faturasDoCartao(c.id) : null;
  // Com faturas, paga-se o que já fechou; sem nada fechado (ou sem as datas), o que está em aberto.
  const aPagar = faturas?.a_pagar || Math.max(aberto, 0);
  const detalhes = [
    ROTULO_BANDEIRA[c.bandeira], c.banco, c.numero && `final ${c.numero}`,
    c.dia_fechamento && `fecha dia ${c.dia_fechamento}`, c.dia_vencimento && `vence dia ${c.dia_vencimento}`,
  ].filter(Boolean).join(' · ');
  const uso = c.limite && barraDeUso(`Uso do limite de ${c.nome}`, ocupado, c.limite, {
    ok: `Disponível ${fmt(c.limite - ocupado)} de ${fmt(c.limite)}`,
    alerta: `Perto do limite · disponível ${fmt(c.limite - ocupado)} de ${fmt(c.limite)}`,
    critico: `Limite de ${fmt(c.limite)} ultrapassado em ${fmt(ocupado - c.limite)}`,
  });
  return h('li', { class: `credito-item ${uso?.nivel ?? ''} ${c.arquivada ? 'fraco' : ''}` },
    h('div', { class: 'credito-topo' },
      h('strong', {}, c.nome, c.arquivada ? h('span', { class: 'etiqueta' }, 'arquivado') : null),
      h('span', { class: 'credito-valor' },
        h('small', {}, aberto < 0 ? 'Crédito a favor' : 'Em aberto'), ' ', fmt(Math.abs(aberto)))),
    detalhes && h('p', { class: 'sub' }, detalhes),
    aVencer > 0 && h('p', { class: 'sub' }, `A vencer nos próximos meses: ${fmt(aVencer)} (parcelas e compras com data futura)`),
    uso?.nos,
    faturas
      ? h('div', { class: 'fatura-linhas' }, [...faturas.fechadas, faturas.aberta].map((f) => linhaFatura(c, f)))
      : h('p', { class: 'sub' }, 'Informe os dias de fechamento e de vencimento para acompanhar as faturas mês a mês.'),
    h('div', { class: 'campo-linha quebra' },
      aPagar > 0 && h('button', {
        type: 'button', class: 'btn pequeno', onclick: () => pagarFatura(c, aPagar),
      }, 'Pagar fatura'),
      faturas && h('a', {
        class: 'btn pequeno', href: `#fatura/${c.id}`, onclick: () => { estado.mesFatura = null; },
      }, 'Ver faturas'),
      h('button', {
        type: 'button', class: 'btn pequeno discreto', 'aria-label': `Editar ${c.nome}`, onclick: () => dialogoCartao(c),
      }, 'Editar')));
}

function secaoCartoes() {
  const cartoes = estado.contas.filter(ehCartao);
  const novo = h('button', { type: 'button', class: 'btn pequeno', onclick: () => dialogoCartao() }, '+ Novo cartão');
  return cartao(
    {
      titulo: 'Cartões de crédito',
      sub: 'Compras no cartão aumentam o valor em aberto; pagar a fatura é transferir de uma conta para o cartão.',
      acoes: novo,
    },
    cartoes.length
      ? h('ul', { class: 'credito-lista' }, cartoes.map(itemCartao))
      : h('p', { class: 'vazio' }, 'Nenhum cartão cadastrado.'));
}

function viewContas() {
  return [secaoContas(), secaoCartoes()];
}

// Fatura de um cartão. O mês em exibição é o do vencimento e é próprio desta tela:
// navegar pelas faturas não muda o mês do painel nem o dos lançamentos.
function viewFatura(parametro) {
  const voltar = h('a', { class: 'btn pequeno discreto', href: '#contas' }, '‹ Contas e cartões');
  const c = estado.contas.find((x) => ehCartao(x) && x.id === Number(parametro));
  if (!c) return [h('section', { class: 'cartao vazio' }, h('p', {}, 'Cartão não encontrado.'), voltar)];
  if (!temFatura(c)) {
    return [h('section', { class: 'cartao vazio' },
      h('p', {}, `Informe os dias de fechamento e de vencimento de ${c.nome} para ver as faturas.`),
      h('div', { class: 'campo-linha centro' },
        h('button', { type: 'button', class: 'btn', onclick: () => dialogoCartao(c) }, 'Editar cartão'), voltar))];
  }
  // Sem mês escolhido, abre na fatura que está recebendo as compras de hoje.
  estado.mesFatura ??= banco.faturasDoCartao(c.id).aberta.mes;
  const f = banco.fatura(c.id, estado.mesFatura);
  const hoje = hojeISO();

  const situacao = {
    futura: { nota: `Começa a receber compras em ${dataBR(f.inicio)}` },
    aberta: { nota: `Recebe compras até ${dataBR(f.fim)}` },
    fechada: { nota: `Vence em ${dataBR(f.vencimento)}` },
    vencida: { nota: `Venceu em ${dataBR(f.vencimento)}`, tom: 'ruim' },
    paga: { nota: 'Fatura quitada', tom: 'bom' },
    zerada: { nota: 'Nada a pagar' },
  }[f.estado];

  const cabecalho = cartao(
    {
      titulo: `${c.nome} · fatura de ${nomeMes(f.mes)}`,
      sub: `Compras de ${dataBR(f.inicio)} a ${dataBR(f.fim)} · fecha em ${dataBR(f.fechamento)} · vence em ${dataBR(f.vencimento)}`,
      acoes: seloFatura(f.estado),
    },
    f.saldo_anterior > 0 && h('p', { class: 'texto' },
      `Antes desta fatura ficaram ${fmt(f.saldo_anterior)} sem pagar. Os pagamentos quitam primeiro esse valor.`),
    h('div', { class: 'campo-linha quebra' },
      f.restante > 0 && h('button', {
        type: 'button', class: 'btn primario', onclick: () => pagarFatura(c, f.restante, f.mes),
      }, 'Pagar fatura'),
      voltar));

  const valores = h('div', { class: 'indicadores iguais' },
    indicador({ rotulo: 'Total da fatura', valor: fmt(f.total) }),
    indicador({ rotulo: 'Pago', valor: fmt(f.pago) }),
    indicador({ rotulo: 'Falta pagar', valor: fmt(f.restante), ...situacao }));

  const linhas = f.lancamentos.map((l) => {
    const estorno = l.tipo === 'receita';
    const categoria = l.tipo === 'transferencia' ? 'Transferência' : l.categoria ?? (estorno ? 'Estorno' : 'Sem categoria');
    return h('tr', { class: 'clicavel', onclick: () => dialogoLancamento(l) },
      h('td', { class: 'data' }, dataBR(l.data).slice(0, 5), h('span', { class: 'larga' }, `/${l.data.slice(0, 4)}`)),
      h('td', {}, l.descricao, etiquetas(l, hoje), h('div', { class: 'detalhe' }, categoria)),
      h('td', { class: `larga ${l.categoria ? '' : 'fraco'}` }, categoria),
      h('td', { class: `num ${estorno ? 'positivo' : ''}` }, estorno ? `− ${fmt(l.valor)}` : fmt(l.valor)));
  });
  const quantos = `${linhas.length} ${linhas.length === 1 ? 'lançamento' : 'lançamentos'}`;
  const lista = cartao({ titulo: 'Lançamentos da fatura', sub: linhas.length ? quantos : null },
    linhas.length
      ? h('div', { class: 'rolagem' }, h('table', {},
        h('thead', {}, h('tr', {},
          h('th', {}, 'Data'), h('th', {}, 'Descrição'), h('th', { class: 'larga' }, 'Categoria'),
          h('th', { class: 'num' }, 'Valor'))),
        h('tbody', {}, linhas),
        h('tfoot', {}, h('tr', {},
          h('td', {}, 'Total'), h('td', {}), h('td', { class: 'larga' }), h('td', { class: 'num' }, fmt(f.total))))))
      : h('p', { class: 'vazio' }, `Nenhum lançamento na fatura de ${nomeMes(f.mes)}.`));

  return [cabecalho, valores, lista];
}

const entradaTexto = (valor, maximo, attrs = {}) =>
  h('input', { type: 'text', maxlength: maximo, autocomplete: 'off', value: valor ?? '', ...attrs });
const entradaValor = (centavos, attrs = {}) => h('input', {
  type: 'text', inputmode: 'decimal', placeholder: '0,00', autocomplete: 'off',
  value: centavos ? decimal(centavos) : '', ...attrs,
});

function dialogoConta(c) {
  const nome = entradaTexto(c?.nome, 60, { autofocus: true });
  const bancoNome = entradaTexto(c?.banco, 60, { placeholder: 'Opcional' });
  const tipo = seletor(Object.entries(ROTULO_CONTA).filter(([t]) => t !== 'cartao'), c?.tipo ?? 'corrente');
  const saldo = entradaValor(c?.saldo_inicial);
  const agencia = entradaTexto(c?.agencia, 20, { inputmode: 'numeric', placeholder: 'Opcional' });
  const numero = entradaTexto(c?.numero, 30, { inputmode: 'numeric', placeholder: 'Opcional' });
  const arquivada = h('input', { type: 'checkbox', checked: Boolean(c?.arquivada) });

  abrirDialogo({
    titulo: c ? 'Editar conta bancária' : 'Nova conta bancária',
    corpo: [
      campo('Nome', nome),
      campo('Banco', bancoNome),
      h('div', { class: 'form-dupla' }, campo('Tipo', tipo), campo('Saldo inicial (R$)', saldo)),
      h('div', { class: 'form-dupla' }, campo('Agência', agencia), campo('Número da conta', numero)),
      c && h('label', { class: 'campo-linha' }, arquivada, 'Arquivada (some das listas e do saldo total)'),
    ],
    aoSalvar: async () => {
      const saldoInicial = lerValor(saldo.value.trim() || '0', { negativo: true });
      if (saldoInicial === null) throw new Error('Saldo inicial inválido. Use um valor como 1.500,00.');
      await banco.salvarConta({
        nome: nome.value, tipo: tipo.value, saldo_inicial: saldoInicial, arquivada: arquivada.checked,
        banco: bancoNome.value, agencia: agencia.value, numero: numero.value,
      }, c?.id);
      avisar('Conta salva.');
    },
    aoExcluir: c && (async () => {
      await banco.excluirConta(c.id);
      avisar('Conta excluída.');
    }),
  });
}

function dialogoCartao(c) {
  const contasBancarias = estado.contas.filter((x) => !ehCartao(x) && (!x.arquivada || x.id === c?.conta_pagamento_id));
  const dia = (valor) => h('input', { type: 'number', min: 1, max: 31, step: 1, inputmode: 'numeric', value: valor ?? '' });
  const lerDia = (entrada) => (entrada.value.trim() === '' ? null : Number(entrada.value));

  const nome = entradaTexto(c?.nome, 60, { autofocus: true });
  const bancoNome = entradaTexto(c?.banco, 60, { placeholder: 'Opcional' });
  const bandeira = seletor([['', 'Não informar'], ...Object.entries(ROTULO_BANDEIRA)], c?.bandeira ?? '');
  const limite = entradaValor(c?.limite, { placeholder: 'Opcional' });
  const final = entradaTexto(c?.numero, 4, { inputmode: 'numeric', placeholder: 'Opcional' });
  const fechamento = dia(c?.dia_fechamento);
  const vencimento = dia(c?.dia_vencimento);
  const pagamento = seletor([['', 'Escolher na hora'], ...contasBancarias.map((x) => [x.id, x.nome])], c?.conta_pagamento_id ?? '');
  // No cadastro o valor em aberto é digitado positivo; no saldo do cartão ele é negativo.
  const aberto = entradaValor(c ? -c.saldo_inicial : 0);
  const arquivada = h('input', { type: 'checkbox', checked: Boolean(c?.arquivada) });

  abrirDialogo({
    titulo: c ? 'Editar cartão de crédito' : 'Novo cartão de crédito',
    corpo: [
      campo('Nome', nome),
      h('div', { class: 'form-dupla' }, campo('Banco emissor', bancoNome), campo('Bandeira', bandeira)),
      h('div', { class: 'form-dupla' }, campo('Limite (R$)', limite), campo('4 últimos dígitos', final)),
      h('div', { class: 'form-dupla' }, campo('Dia do fechamento', fechamento), campo('Dia do vencimento', vencimento)),
      campo('Conta que paga a fatura', pagamento),
      campo('Valor já em aberto ao cadastrar (R$)', aberto),
      c && h('label', { class: 'campo-linha' }, arquivada, 'Arquivado (some das listas)'),
    ],
    aoSalvar: async () => {
      const valorLimite = limite.value.trim() ? lerValor(limite.value) : null;
      if (limite.value.trim() && !valorLimite) throw new Error('Limite inválido. Use um valor como 5.000,00.');
      const valorAberto = lerValor(aberto.value.trim() || '0', { negativo: true });
      if (valorAberto === null) throw new Error('Valor em aberto inválido. Use um valor como 350,00.');
      await banco.salvarConta({
        nome: nome.value, tipo: 'cartao', saldo_inicial: -valorAberto || 0, arquivada: arquivada.checked,
        banco: bancoNome.value, numero: final.value, bandeira: bandeira.value, limite: valorLimite,
        dia_fechamento: lerDia(fechamento), dia_vencimento: lerDia(vencimento),
        conta_pagamento_id: pagamento.value ? Number(pagamento.value) : null,
      }, c?.id);
      avisar('Cartão salvo.');
    },
    aoExcluir: c && (async () => {
      await banco.excluirConta(c.id);
      avisar('Cartão excluído.');
    }),
  });
}

// ---------------------------------------------------------------- ajustes

function blocoCategorias(tipo, titulo) {
  const itens = estado.categorias.filter((c) => c.tipo === tipo);
  const nova = h('button', {
    type: 'button', class: 'btn pequeno', onclick: () => dialogoCategoria(null, tipo),
  }, '+ Nova categoria');
  return cartao({ titulo, acoes: nova },
    itens.length
      ? h('ul', { class: 'lista' }, itens.map((c) => h('li', {},
        h('span', {}, c.nome),
        h('button', {
          type: 'button', class: 'btn pequeno discreto',
          'aria-label': `Editar ${c.nome}`, onclick: () => dialogoCategoria(c, tipo),
        }, 'Editar'))))
      : h('p', { class: 'vazio' }, 'Nenhuma categoria.'));
}

function dialogoCategoria(c, tipo) {
  const nome = h('input', { type: 'text', maxlength: 60, autocomplete: 'off', autofocus: true, value: c?.nome ?? '' });
  abrirDialogo({
    titulo: `${c ? 'Editar' : 'Nova'} categoria de ${tipo}`,
    corpo: campo('Nome', nome),
    aoSalvar: async () => {
      await banco.salvarCategoria({ nome: nome.value, tipo }, c?.id);
      avisar('Categoria salva.');
    },
    aoExcluir: c && (async () => {
      await banco.excluirCategoria(c.id);
      avisar('Categoria excluída.');
    }),
  });
}

function cartaoBackup() {
  const ultimo = lerLocal('ultimo-backup');

  // O seletor de arquivos fica escondido; o botão "Restaurar backup" o aciona.
  const arquivo = h('input', {
    type: 'file', accept: '.json,application/json', hidden: true, 'aria-label': 'Arquivo de backup',
    onchange: async () => {
      const [escolhido] = arquivo.files;
      arquivo.value = '';
      if (!escolhido) return;
      try {
        const backup = validarBackup(JSON.parse(await escolhido.text()));
        const pergunta = `Restaurar este backup?\n\nEle tem ${backup.lancamentos.length} lançamento(s) e `
          + `${backup.contas.length} conta(s), e vai substituir todos os dados guardados neste aparelho.`;
        if (!confirm(pergunta)) return;
        await banco.importar(backup);
        avisar('Backup restaurado.');
        aposMudanca();
      } catch (erro) {
        avisar(erro instanceof SyntaxError
          ? 'Este arquivo não é um backup válido do Controle Financeiro.' : erro.message);
      }
    },
  });

  const fazerBackup = () => {
    const hoje = hojeISO();
    baixar(`controle-financeiro-backup-${hoje}.json`, JSON.stringify(banco.exportar()), 'application/json');
    gravarLocal('ultimo-backup', hoje);
    avisar('Backup salvo na pasta de downloads.');
    renderizar();
  };

  const instalar = convite && h('button', {
    type: 'button', class: 'btn',
    onclick: async () => {
      convite.prompt();
      await convite.userChoice;
      convite = null;
      renderizar();
    },
  }, 'Instalar app');

  return cartao(
    { titulo: 'Backup e dados', sub: ultimo ? `Último backup neste aparelho: ${dataBR(ultimo)}` : 'Nenhum backup feito neste aparelho ainda' },
    h('p', { class: 'texto' }, 'Seus dados ficam guardados só neste aparelho, dentro do navegador. Faça backup de vez em '
      + 'quando: se você limpar os dados do navegador, desinstalar o app ou trocar de aparelho, é o arquivo de '
      + 'backup que traz tudo de volta.'),
    h('div', { class: 'campo-linha quebra' },
      h('button', { type: 'button', class: 'btn primario', onclick: fazerBackup }, 'Fazer backup'),
      h('button', { type: 'button', class: 'btn', onclick: () => arquivo.click() }, 'Restaurar backup'),
      instalar,
      arquivo));
}

function viewAjustes() {
  // O backup vem primeiro: é o que se procura ao chegar aqui, sobretudo em um aparelho novo.
  return [
    cartaoBackup(),
    h('div', { class: 'grade-2' },
      blocoCategorias('despesa', 'Categorias de despesa'),
      blocoCategorias('receita', 'Categorias de receita')),
  ];
}

// ---------------------------------------------------------------- navegação

// chaveMes: qual mês do estado os botões de mês da tela movem. menu: item do menu que fica
// marcado quando a tela não tem um item próprio.
const VIEWS = {
  painel: { titulo: 'Painel', chaveMes: 'mes', render: viewPainel },
  lancamentos: { titulo: 'Lançamentos', chaveMes: 'mes', render: viewLancamentos },
  orcamento: { titulo: 'Orçamento', chaveMes: 'mes', render: viewOrcamento },
  contas: { titulo: 'Contas e cartões', render: viewContas },
  fatura: { titulo: 'Fatura do cartão', chaveMes: 'mesFatura', menu: 'contas', render: viewFatura },
  ajustes: { titulo: 'Ajustes', render: viewAjustes },
};

// A tela vem do endereço: "#lancamentos", ou "#fatura/3" para a fatura do cartão 3.
function telaAtual() {
  const [hash, parametro] = location.hash.slice(1).split('/');
  const nome = Object.hasOwn(VIEWS, hash) ? hash : 'painel';
  return { nome, view: VIEWS[nome], parametro };
}

function telaDeErro(erro) {
  return h('section', { class: 'cartao vazio' }, `Não foi possível carregar: ${erro.message}`);
}

function renderizar() {
  const { nome, view, parametro } = telaAtual();

  $('#titulo').textContent = view.titulo;
  document.title = `${view.titulo} · Controle Financeiro`;
  for (const link of document.querySelectorAll('#nav a')) {
    if (link.getAttribute('href') === `#${view.menu ?? nome}`) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }

  esconderDica();
  let nos;
  try {
    nos = view.render(parametro);
  } catch (erro) {
    nos = [telaDeErro(erro)];
  }
  // Depois de montar a tela: a da fatura escolhe o próprio mês ao ser aberta.
  $('#mes-nav').hidden = !view.chaveMes;
  if (view.chaveMes) $('#mes-rotulo').textContent = nomeMes(estado[view.chaveMes] ?? estado.mes);
  const alvo = $('#view');
  alvo.replaceChildren(...nos.filter(Boolean));
  aoRedimensionar.disconnect();
  for (const grafico of alvo.querySelectorAll('.grafico')) aoRedimensionar.observe(grafico);
}

// passo: -1 ou 1 para andar um mês; 0 para voltar ao mês atual.
function mudarMes(passo) {
  const { chaveMes } = telaAtual().view;
  if (passo) estado[chaveMes] = deslocarMes(estado[chaveMes] ?? estado.mes, passo);
  // Na fatura, o "mês atual" é o da fatura aberta, que a própria tela descobre.
  else estado[chaveMes] = chaveMes === 'mes' ? isoMes(new Date()) : null;
  renderizar();
}

$('#mes-anterior').addEventListener('click', () => mudarMes(-1));
$('#mes-proximo').addEventListener('click', () => mudarMes(1));
$('#mes-rotulo').addEventListener('click', () => mudarMes(0));
$('#novo-lancamento').addEventListener('click', () => dialogoLancamento());
window.addEventListener('hashchange', () => {
  renderizar();
  scrollTo(0, 0);
});

// O navegador avisa quando o app pode ser instalado; o botão aparece em Ajustes.
window.addEventListener('beforeinstallprompt', (ev) => {
  ev.preventDefault();
  convite = ev;
  if (location.hash === '#ajustes') renderizar();
});
window.addEventListener('appinstalled', () => {
  convite = null;
  if (location.hash === '#ajustes') renderizar();
});

try {
  banco = await abrirBanco();
  carregarBase();
  renderizar();
} catch (erro) {
  $('#view').replaceChildren(telaDeErro(erro));
}

// Guarda os arquivos do app no aparelho para ele abrir sem internet.
if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
