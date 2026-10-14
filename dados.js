// Dados e regras do Controle Financeiro, guardados no próprio aparelho (IndexedDB).
//
// Tudo é carregado em memória ao abrir e relido após cada gravação: o volume de um
// controle pessoal é pequeno, e assim as consultas são simples filtros de lista.
// Valores monetários são inteiros em centavos. O saldo de uma conta considera só os
// lançamentos com data até hoje; os futuros entram nos totais do mês como previstos.

// Um cartão de crédito é uma conta do tipo "cartao": as compras deixam o saldo negativo
// (o valor em aberto) e o pagamento da fatura é uma transferência de uma conta para ele.
export const TIPOS_CONTA = ['corrente', 'poupanca', 'carteira', 'cartao', 'investimento'];
export const BANDEIRAS = ['visa', 'mastercard', 'elo', 'amex', 'hipercard', 'outra'];
// Campos opcionais do cadastro; registros gravados antes de eles existirem os recebem na leitura.
const OPCIONAIS_CONTA = {
  banco: '', agencia: '', numero: '',
  bandeira: '', limite: null, dia_fechamento: null, dia_vencimento: null, conta_pagamento_id: null,
};
// Uma compra parcelada vira um lançamento por mês. Os três campos identificam a parcela
// ("3 de 12") e a compra a que ela pertence; ficam nulos nos lançamentos comuns.
export const MAX_PARCELAS = 48;
const SEM_PARCELA = { parcela_numero: null, parcela_total: null, parcela_grupo: null };
const TIPOS_CATEGORIA = ['receita', 'despesa'];
const TIPOS_LANCAMENTO = ['receita', 'despesa', 'transferencia'];
const ROTULO_TIPO = { receita: 'Receita', despesa: 'Despesa', transferencia: 'Transferência' };
const VALOR_MAXIMO = 10 ** 13; // R$ 100 bilhões: barra erros grosseiros de digitação
const MESES_HISTORICO = 6;
const LOJAS = ['contas', 'categorias', 'lancamentos', 'orcamentos'];
const FORMATO_BACKUP = 'controle-financeiro';
// Versões do backup: 2 = cada limite de orçamento guarda desde que mês vale;
// 3 = contas com banco, agência e número, e cartões com limite, bandeira e datas;
// 4 = lançamentos de compras parceladas.
const VERSAO_BACKUP = 4;
const VERSAO_BANCO = 2;
// Mês atribuído aos limites criados antes de o orçamento ter histórico: eles valiam
// para todos os meses, então continuam valendo desde sempre.
const DESDE_SEMPRE = '0000-01';

const CONTAS_INICIAIS = [['Carteira', 'carteira'], ['Conta corrente', 'corrente']];
const CATEGORIAS_INICIAIS = [
  ['Moradia', 'despesa'], ['Alimentação', 'despesa'], ['Transporte', 'despesa'],
  ['Saúde', 'despesa'], ['Educação', 'despesa'], ['Lazer', 'despesa'],
  ['Contas e serviços', 'despesa'], ['Vestuário', 'despesa'], ['Outras despesas', 'despesa'],
  ['Salário', 'receita'], ['Rendimentos', 'receita'], ['Outras receitas', 'receita'],
];

/** Erro de regra de negócio: a mensagem é mostrada ao usuário como está. */
export class Erro extends Error {}

// ---------------------------------------------------------------- datas e textos

const pad = (n) => String(n).padStart(2, '0');

export function hojeISO() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Desloca um mês "AAAA-MM" em n meses. */
export function somarMeses(mes, n) {
  const total = Number(mes.slice(0, 4)) * 12 + Number(mes.slice(5, 7)) - 1 + n;
  return `${Math.floor(total / 12)}-${pad((total % 12) + 1)}`;
}

/** A mesma data n meses depois; em mês mais curto o dia recua para o último (31 vira 28, 29 ou 30). */
export function somarMesesNaData(data, n) {
  return diaNoMes(somarMeses(data.slice(0, 7), n), Number(data.slice(8, 10)));
}

// Um dia do mês como data; em mês mais curto recua para o último dia.
function diaNoMes(mes, dia) {
  const ultimoDia = new Date(Date.UTC(Number(mes.slice(0, 4)), Number(mes.slice(5, 7)), 0)).getUTCDate();
  return `${mes}-${pad(Math.min(dia, ultimoDia))}`;
}

function diaAnterior(data) {
  const d = new Date(Date.UTC(Number(data.slice(0, 4)), Number(data.slice(5, 7)) - 1, Number(data.slice(8, 10)) - 1));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

// A fatura de um cartão é identificada pelo mês em que vence. Ela fecha no dia de
// fechamento do mesmo mês, quando esse dia vem antes do vencimento, ou do mês anterior,
// quando não vem (fecha dia 25 e vence dia 5: a fatura de novembro fecha em 25/10 e
// vence em 05/11). Entram nela as compras feitas do fechamento anterior até a véspera
// do seu fechamento: a compra feita no dia do fechamento já é da fatura seguinte.

/** Datas de fechamento e de vencimento da fatura do cartão que vence no mês informado. */
export function datasDaFatura(cartao, mes) {
  const mesDoFechamento = cartao.dia_fechamento < cartao.dia_vencimento ? mes : somarMeses(mes, -1);
  return {
    fechamento: diaNoMes(mesDoFechamento, cartao.dia_fechamento),
    vencimento: diaNoMes(mes, cartao.dia_vencimento),
  };
}

/** Mês (de vencimento) da fatura em que entra uma compra feita na data informada. */
export function mesDaFatura(cartao, data) {
  let mes = data.slice(0, 7);
  while (data >= datasDaFatura(cartao, mes).fechamento) mes = somarMeses(mes, 1);
  while (data < datasDaFatura(cartao, somarMeses(mes, -1)).fechamento) mes = somarMeses(mes, -1);
  return mes;
}

function dataValida(valor) {
  if (typeof valor !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(valor)) return false;
  const [ano, mes, dia] = valor.split('-').map(Number);
  const data = new Date(Date.UTC(ano, mes - 1, dia));
  return data.getUTCFullYear() === ano && data.getUTCMonth() === mes - 1 && data.getUTCDate() === dia;
}

const mesValido = (mes) => typeof mes === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(mes);

function exigirMes(mes) {
  if (!mesValido(mes)) throw new Erro('Mês inválido. Use o formato AAAA-MM.');
}

const comparar = new Intl.Collator('pt-BR', { sensitivity: 'accent' }).compare;
const mesmoNome = (a, b) => comparar(a, b) === 0;
// Busca sem diferenciar maiúsculas nem acentos: "farmacia" encontra "Farmácia".
const semAcento = (valor) => valor.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

function texto(valor, mensagem, maximo) {
  if (typeof valor !== 'string' || !valor.trim()) throw new Erro(mensagem);
  if (valor.trim().length > maximo) throw new Erro(`Use no máximo ${maximo} caracteres.`);
  return valor.trim();
}

function centavos(valor, mensagem = 'Informe um valor maior que zero.', positivo = true) {
  if (!Number.isInteger(valor) || (positivo && valor <= 0) || Math.abs(valor) > VALOR_MAXIMO) {
    throw new Erro(mensagem);
  }
  return valor;
}

function textoOpcional(valor, maximo) {
  if (valor === undefined || valor === null) return '';
  if (typeof valor !== 'string') throw new Erro('Texto inválido.');
  if (valor.trim().length > maximo) throw new Erro(`Use no máximo ${maximo} caracteres.`);
  return valor.trim();
}

function diaDoMes(valor, mensagem) {
  if (valor === undefined || valor === null) return null;
  if (!Number.isInteger(valor) || valor < 1 || valor > 31) throw new Erro(mensagem);
  return valor;
}

/**
 * Confere os campos de uma conta bancária ou de um cartão e devolve o registro completo.
 * Não confere o que depende dos outros registros (nome repetido, conta de pagamento).
 */
function normalizarConta(dados) {
  const cartao = dados?.tipo === 'cartao';
  const nome = texto(dados?.nome, cartao ? 'Informe o nome do cartão.' : 'Informe o nome da conta.', 60);
  if (!TIPOS_CONTA.includes(dados.tipo)) throw new Erro('Tipo de conta inválido.');
  const registro = {
    ...OPCIONAIS_CONTA,
    nome,
    tipo: dados.tipo,
    saldo_inicial: centavos(dados.saldo_inicial ?? 0, 'Saldo inicial inválido.', false),
    arquivada: Boolean(dados.arquivada),
    banco: textoOpcional(dados.banco, 60),
    numero: textoOpcional(dados.numero, 30),
  };
  if (!cartao) return { ...registro, agencia: textoOpcional(dados.agencia, 20) };

  // Do número do cartão só se guardam os 4 últimos dígitos, para identificá-lo.
  if (registro.numero && !/^\d{4}$/.test(registro.numero)) {
    throw new Erro('Informe só os 4 últimos dígitos do cartão.');
  }
  const bandeira = dados.bandeira ?? '';
  if (bandeira !== '' && !BANDEIRAS.includes(bandeira)) throw new Erro('Bandeira inválida.');
  return {
    ...registro,
    bandeira,
    limite: dados.limite === undefined || dados.limite === null
      ? null : centavos(dados.limite, 'Informe um limite maior que zero.'),
    dia_fechamento: diaDoMes(dados.dia_fechamento, 'O dia de fechamento deve ficar entre 1 e 31.'),
    dia_vencimento: diaDoMes(dados.dia_vencimento, 'O dia de vencimento deve ficar entre 1 e 31.'),
    conta_pagamento_id: dados.conta_pagamento_id ?? null,
  };
}

// ---------------------------------------------------------------- backup

/**
 * Confere um backup lido de arquivo e devolve uma cópia só com os campos conhecidos.
 * O arquivo vem de fora do app, então nada nele é aceito sem verificação.
 */
export function validarBackup(backup) {
  const falha = () => {
    throw new Erro('Este arquivo não é um backup válido do Controle Financeiro.');
  };
  if (backup?.formato !== FORMATO_BACKUP || !LOJAS.every((loja) => Array.isArray(backup[loja]))) falha();
  if (!Number.isInteger(backup.versao) || backup.versao < 1) falha();
  if (backup.versao > VERSAO_BACKUP) {
    throw new Erro('Este backup foi criado por uma versão mais nova do app. Atualize o app e tente de novo.');
  }
  const idValido = (valor) => Number.isInteger(valor) && valor > 0;
  const textoValido = (valor, maximo) => typeof valor === 'string' && valor.trim() !== '' && valor.length <= maximo;
  const valorValido = (valor) => Number.isInteger(valor) && Math.abs(valor) <= VALOR_MAXIMO;

  const tipoConta = new Map();
  const contas = backup.contas.map((c) => {
    if (!idValido(c?.id) || tipoConta.has(c.id)) falha();
    let registro;
    try {
      registro = normalizarConta(c);
    } catch {
      falha();
    }
    tipoConta.set(c.id, registro.tipo);
    return { id: c.id, ...registro };
  });
  for (const c of contas) {
    const paga = c.conta_pagamento_id;
    if (paga !== null && (!tipoConta.has(paga) || tipoConta.get(paga) === 'cartao')) falha();
  }

  const tipoCategoria = new Map();
  const categorias = backup.categorias.map((c) => {
    if (!idValido(c?.id) || tipoCategoria.has(c.id) || !textoValido(c.nome, 60)
      || !TIPOS_CATEGORIA.includes(c.tipo)) falha();
    tipoCategoria.set(c.id, c.tipo);
    return { id: c.id, nome: c.nome.trim(), tipo: c.tipo };
  });

  const idsLancamentos = new Set();
  const lancamentos = backup.lancamentos.map((l) => {
    if (!idValido(l?.id) || idsLancamentos.has(l.id) || !dataValida(l.data) || !textoValido(l.descricao, 200)
      || !valorValido(l.valor) || l.valor <= 0 || !TIPOS_LANCAMENTO.includes(l.tipo)
      || !tipoConta.has(l.conta_id)) falha();
    const transferencia = l.tipo === 'transferencia';
    const destino = l.conta_destino_id ?? null;
    const categoria = l.categoria_id ?? null;
    if (transferencia ? (!tipoConta.has(destino) || destino === l.conta_id || categoria !== null)
      : (destino !== null || (categoria !== null && tipoCategoria.get(categoria) !== l.tipo))) falha();
    const parcela = {
      parcela_numero: l.parcela_numero ?? null,
      parcela_total: l.parcela_total ?? null,
      parcela_grupo: l.parcela_grupo ?? null,
    };
    const { parcela_numero: numero, parcela_total: total, parcela_grupo: grupo } = parcela;
    const comum = numero === null && total === null && grupo === null;
    const parcelaValida = Number.isInteger(total) && total >= 2 && total <= MAX_PARCELAS
      && Number.isInteger(numero) && numero >= 1 && numero <= total && textoValido(grupo, 64);
    if (!comum && !parcelaValida) falha();
    idsLancamentos.add(l.id);
    return {
      id: l.id, data: l.data, descricao: l.descricao.trim(), valor: l.valor, tipo: l.tipo,
      conta_id: l.conta_id, conta_destino_id: destino, categoria_id: categoria, ...parcela,
    };
  });

  const mudancas = new Set();
  const orcamentos = backup.orcamentos.map((o) => {
    // Backups da versão 1 não tinham mês: o limite valia para todos.
    const mes = backup.versao === 1 ? DESDE_SEMPRE : o?.mes;
    const limite = o?.limite ?? null;
    const chave = `${o?.categoria_id}/${mes}`;
    if (tipoCategoria.get(o?.categoria_id) !== 'despesa' || !mesValido(mes) || mudancas.has(chave)
      || (limite !== null && (!valorValido(limite) || limite <= 0))) falha();
    mudancas.add(chave);
    return { categoria_id: o.categoria_id, mes, limite };
  });

  // Devolve um backup completo: conferir de novo o que já foi conferido tem de dar certo.
  return { formato: FORMATO_BACKUP, versao: VERSAO_BACKUP, contas, categorias, lancamentos, orcamentos };
}

// ---------------------------------------------------------------- IndexedDB

function abrirIDB(nome) {
  return new Promise((ok, falha) => {
    const pedido = indexedDB.open(nome, VERSAO_BANCO);
    pedido.onupgradeneeded = (ev) => {
      const idb = pedido.result;
      const criarOrcamentos = () => idb.createObjectStore('orcamentos', { keyPath: ['categoria_id', 'mes'] });
      if (ev.oldVersion < 1) {
        const contas = idb.createObjectStore('contas', { keyPath: 'id', autoIncrement: true });
        const categorias = idb.createObjectStore('categorias', { keyPath: 'id', autoIncrement: true });
        idb.createObjectStore('lancamentos', { keyPath: 'id', autoIncrement: true });
        criarOrcamentos();
        // Na mesma transação que cria as lojas: o banco nunca existe vazio pela metade.
        for (const [nomeConta, tipo] of CONTAS_INICIAIS) {
          contas.add({ nome: nomeConta, tipo, saldo_inicial: 0, arquivada: false });
        }
        for (const [nomeCategoria, tipo] of CATEGORIAS_INICIAIS) categorias.add({ nome: nomeCategoria, tipo });
      } else if (ev.oldVersion < 2) {
        // Versão 1 guardava um limite por categoria, sem mês. A loja muda de chave,
        // então é recriada, e os limites existentes são mantidos como "desde sempre".
        pedido.transaction.objectStore('orcamentos').getAll().onsuccess = (lidos) => {
          idb.deleteObjectStore('orcamentos');
          const loja = criarOrcamentos();
          for (const o of lidos.target.result) {
            loja.add({ categoria_id: o.categoria_id, mes: DESDE_SEMPRE, limite: o.limite });
          }
        };
      }
    };
    pedido.onsuccess = () => ok(pedido.result);
    pedido.onerror = () => falha(pedido.error);
  });
}

/** Abre (e cria, na primeira vez) o banco deste aparelho. */
export async function abrirBanco(nome = 'controle-financeiro') {
  const idb = await abrirIDB(nome);
  // Outra aba pedindo uma versão nova do banco não deve ficar travada por esta.
  idb.onversionchange = () => idb.close();
  let mem = { contas: [], categorias: [], lancamentos: [], orcamentos: [] };

  function transacao(modo, acao) {
    return new Promise((ok, falha) => {
      const tx = idb.transaction(LOJAS, modo);
      tx.oncomplete = () => ok();
      tx.onabort = () => falha(tx.error ?? new Error('A gravação foi cancelada.'));
      try {
        acao((loja) => tx.objectStore(loja));
      } catch (erro) {
        // Sem isto, o que já foi pedido antes da falha seria gravado pela metade.
        tx.abort();
        falha(erro);
      }
    });
  }

  async function recarregar() {
    const lido = {};
    await transacao('readonly', (em) => {
      for (const loja of LOJAS) em(loja).getAll().onsuccess = (ev) => { lido[loja] = ev.target.result; };
    });
    lido.contas = lido.contas.map((c) => ({ ...OPCIONAIS_CONTA, ...c }));
    lido.lancamentos = lido.lancamentos.map((l) => ({ ...SEM_PARCELA, ...l }));
    mem = lido;
  }

  async function escrever(acao) {
    await transacao('readwrite', acao);
    await recarregar();
  }

  // Inclui (sem id) ou substitui (com id) e devolve a chave do registro.
  async function gravar(loja, registro, id) {
    let chave;
    await escrever((em) => {
      em(loja).put(id === undefined ? registro : { ...registro, id }).onsuccess = (ev) => { chave = ev.target.result; };
    });
    return chave;
  }

  const buscar = (loja, id) => mem[loja].find((registro) => registro.id === id);

  function exigir(loja, id) {
    const registro = buscar(loja, id);
    if (!registro) throw new Erro('Registro não encontrado.');
    return registro;
  }

  // ---- consultas

  // saldo: lançamentos com data até hoje. saldo_previsto: todos, inclusive os de data
  // futura (em um cartão, é o que mostra quanto do limite as parcelas a vencer já ocupam).
  function contas() {
    const hoje = hojeISO();
    const saldo = new Map(mem.contas.map((c) => [c.id, c.saldo_inicial]));
    const previsto = new Map(saldo);
    const somar = (mapa, id, valor) => mapa.set(id, mapa.get(id) + valor);
    for (const l of mem.lancamentos) {
      const efeito = l.tipo === 'receita' ? l.valor : -l.valor;
      for (const mapa of l.data > hoje ? [previsto] : [previsto, saldo]) {
        somar(mapa, l.conta_id, efeito);
        if (l.conta_destino_id !== null) somar(mapa, l.conta_destino_id, l.valor);
      }
    }
    return mem.contas
      .map((c) => ({ ...c, saldo: saldo.get(c.id), saldo_previsto: previsto.get(c.id) }))
      .sort((a, b) => a.arquivada - b.arquivada || comparar(a.nome, b.nome));
  }

  function categorias() {
    return [...mem.categorias].sort((a, b) => comparar(a.tipo, b.tipo) || comparar(a.nome, b.nome));
  }

  /** Lançamentos do mês, do mais recente para o mais antigo, com os filtros opcionais. */
  function lancamentos({ mes, tipo, conta_id: contaId, categoria_id: categoriaId, q } = {}) {
    exigirMes(mes);
    if (tipo && !TIPOS_LANCAMENTO.includes(tipo)) throw new Erro('Tipo de lançamento inválido.');
    const busca = semAcento((q ?? '').trim());
    return detalhar(mem.lancamentos.filter((l) => l.data.startsWith(mes)
      && (!tipo || l.tipo === tipo)
      && (!contaId || l.conta_id === contaId || l.conta_destino_id === contaId)
      && (!categoriaId || l.categoria_id === categoriaId)
      && (!busca || semAcento(l.descricao).includes(busca))));
  }

  // Ordena do mais recente para o mais antigo e acrescenta os nomes de conta e categoria.
  function detalhar(lista) {
    const nomeConta = new Map(mem.contas.map((c) => [c.id, c.nome]));
    const nomeCategoria = new Map(mem.categorias.map((c) => [c.id, c.nome]));
    return [...lista]
      .sort((a, b) => (a.data === b.data ? b.id - a.id : a.data < b.data ? 1 : -1))
      .map((l) => ({
        ...l,
        conta: nomeConta.get(l.conta_id),
        conta_destino: nomeConta.get(l.conta_destino_id) ?? null,
        categoria: nomeCategoria.get(l.categoria_id) ?? null,
      }));
  }

  // ---- faturas de cartão
  //
  // Os pagamentos (transferências de uma conta para o cartão) não são ligados a uma fatura
  // específica: eles quitam primeiro o que o cartão já devia ao ser cadastrado e depois as
  // faturas, da mais antiga para a mais nova. Pagar parte de uma fatura deixa o resto em
  // aberto nela, e o pagamento seguinte começa por esse resto.

  function cartaoComFatura(cartaoId) {
    const cartao = exigir('contas', cartaoId);
    if (cartao.tipo !== 'cartao') throw new Erro('Só cartões de crédito têm fatura.');
    if (!cartao.dia_fechamento || !cartao.dia_vencimento) {
      throw new Erro('Informe os dias de fechamento e de vencimento do cartão para ver as faturas.');
    }
    return cartao;
  }

  // Na fatura, despesas e saques somam; estornos (receitas no cartão) descontam.
  const totalDe = (lista) => lista.reduce((soma, l) => soma + (l.tipo === 'receita' ? -l.valor : l.valor), 0);

  // Uma passada pelos lançamentos: separa o que foi lançado no cartão por fatura e soma os
  // pagamentos feitos até a data de referência.
  function movimentoDoCartao(cartao, hoje) {
    const porFatura = new Map();
    let pagamentos = Math.max(cartao.saldo_inicial, 0);
    for (const l of mem.lancamentos) {
      if (l.conta_destino_id === cartao.id) {
        if (l.data <= hoje) pagamentos += l.valor;
      } else if (l.conta_id === cartao.id) {
        const mes = mesDaFatura(cartao, l.data);
        if (!porFatura.has(mes)) porFatura.set(mes, []);
        porFatura.get(mes).push(l);
      }
    }
    return { porFatura, pagamentos };
  }

  function montarFatura(cartao, mes, { porFatura, pagamentos }, hoje) {
    const { fechamento, vencimento } = datasDaFatura(cartao, mes);
    const inicio = datasDaFatura(cartao, somarMeses(mes, -1)).fechamento;
    const itens = porFatura.get(mes) ?? [];
    const total = totalDe(itens);
    // Tudo o que veio antes desta fatura: a dívida do cadastro e as faturas anteriores.
    let anterior = Math.max(-cartao.saldo_inicial, 0);
    for (const [outroMes, lista] of porFatura) if (outroMes < mes) anterior += totalDe(lista);
    const sobra = pagamentos - anterior; // o que os pagamentos ainda cobrem depois do que veio antes
    const pago = Math.min(Math.max(sobra, 0), Math.max(total, 0));
    const restante = Math.max(total, 0) - pago;

    let estado;
    if (hoje < inicio) estado = 'futura';
    else if (hoje < fechamento) estado = 'aberta';
    else if (total <= 0) estado = 'zerada';
    else if (restante === 0) estado = 'paga';
    else estado = hoje > vencimento ? 'vencida' : 'fechada';

    return {
      cartao_id: cartao.id,
      mes,
      inicio,
      fim: diaAnterior(fechamento),
      fechamento,
      vencimento,
      total,
      pago,
      restante,
      saldo_anterior: Math.max(-sobra, 0), // o que ficou sem pagar antes desta fatura
      estado,
      lancamentos: detalhar(itens),
    };
  }

  /**
   * Fatura do cartão que vence no mês informado: período, datas, lançamentos, total, quanto
   * já foi pago e a situação (futura, aberta, fechada, vencida, paga ou zerada) na data de
   * referência.
   */
  function fatura(cartaoId, mes, hoje = hojeISO()) {
    const cartao = cartaoComFatura(cartaoId);
    exigirMes(mes);
    return montarFatura(cartao, mes, movimentoDoCartao(cartao, hoje), hoje);
  }

  /**
   * Situação das faturas do cartão na data de referência: a que está aberta, as que já
   * fecharam e ainda têm valor a pagar (da mais antiga para a mais nova) e o total a pagar
   * agora, que inclui o que restar da dívida informada no cadastro.
   */
  function faturasDoCartao(cartaoId, hoje = hojeISO()) {
    const cartao = cartaoComFatura(cartaoId);
    const movimento = movimentoDoCartao(cartao, hoje);
    const mesAberta = mesDaFatura(cartao, hoje);
    const fechadas = [...movimento.porFatura.keys()]
      .filter((mes) => mes < mesAberta)
      .sort()
      .map((mes) => montarFatura(cartao, mes, movimento, hoje))
      .filter((f) => f.restante > 0);
    const doCadastro = Math.max(Math.max(-cartao.saldo_inicial, 0) - movimento.pagamentos, 0);
    return {
      aberta: montarFatura(cartao, mesAberta, movimento, hoje),
      fechadas,
      a_pagar: doCadastro + fechadas.reduce((soma, f) => soma + f.restante, 0),
    };
  }

  // Cada registro de orçamento é uma mudança: "a partir deste mês o limite da categoria
  // é X" (null = sem limite). O limite de um mês é o da mudança mais recente até ele,
  // por isso alterar um mês nunca mexe nos anteriores.
  function limitesEm(mes) {
    const vigente = new Map();
    for (const o of mem.orcamentos) {
      if (o.mes <= mes && !(vigente.get(o.categoria_id)?.mes > o.mes)) vigente.set(o.categoria_id, o);
    }
    return new Map([...vigente].map(([categoriaId, o]) => [categoriaId, o.limite]));
  }

  /** Todas as categorias de despesa, com o limite (ou null) e o gasto no mês. */
  function orcamentos(mes) {
    exigirMes(mes);
    const limite = limitesEm(mes);
    const gasto = new Map();
    for (const l of mem.lancamentos) {
      if (l.tipo === 'despesa' && l.categoria_id !== null && l.data.startsWith(mes)) {
        gasto.set(l.categoria_id, (gasto.get(l.categoria_id) ?? 0) + l.valor);
      }
    }
    return categorias().filter((c) => c.tipo === 'despesa').map((c) => ({
      categoria_id: c.id, nome: c.nome, limite: limite.get(c.id) ?? null, gasto: gasto.get(c.id) ?? 0,
    }));
  }

  function resumo(mes) {
    exigirMes(mes);
    const historico = Array.from({ length: MESES_HISTORICO }, (_, i) => (
      { mes: somarMeses(mes, i + 1 - MESES_HISTORICO), receitas: 0, despesas: 0 }));
    const pontoDoMes = new Map(historico.map((ponto) => [ponto.mes, ponto]));
    const gasto = new Map();
    for (const l of mem.lancamentos) {
      if (l.tipo === 'transferencia') continue;
      const ponto = pontoDoMes.get(l.data.slice(0, 7));
      if (ponto) ponto[l.tipo === 'receita' ? 'receitas' : 'despesas'] += l.valor;
      if (l.tipo === 'despesa' && l.data.startsWith(mes)) {
        gasto.set(l.categoria_id, (gasto.get(l.categoria_id) ?? 0) + l.valor);
      }
    }
    const nomeCategoria = new Map(mem.categorias.map((c) => [c.id, c.nome]));
    const atual = historico[historico.length - 1];
    const ativas = contas().filter((c) => !c.arquivada);
    return {
      mes,
      // O saldo é o dinheiro nas contas; o que se deve nos cartões é informado à parte.
      saldo_total: ativas.reduce((soma, c) => soma + (c.tipo === 'cartao' ? 0 : c.saldo), 0),
      cartoes_em_aberto: ativas.reduce((soma, c) => soma + (c.tipo === 'cartao' ? -c.saldo : 0), 0),
      receitas: atual.receitas,
      despesas: atual.despesas,
      historico,
      por_categoria: [...gasto]
        .map(([id, total]) => ({ categoria_id: id, nome: nomeCategoria.get(id) ?? 'Sem categoria', total }))
        .sort((a, b) => b.total - a.total),
      orcamentos: orcamentos(mes).filter((o) => o.limite !== null),
      total_lancamentos: mem.lancamentos.length,
    };
  }

  /** CSV dos lançamentos filtrados, pronto para abrir no Excel em português. */
  function csv(filtros) {
    const celula = (valor) => {
      // Planilhas executam células iniciadas por = + - @; o apóstrofo as neutraliza.
      const limpo = /^[=+\-@]/.test(valor ?? '') ? `'${valor}` : valor ?? '';
      return /[;"\r\n]/.test(limpo) ? `"${limpo.replaceAll('"', '""')}"` : limpo;
    };
    const linhas = lancamentos(filtros).map((l) => [
      l.data.split('-').reverse().join('/'),
      celula(l.parcela_total ? `${l.descricao} (${l.parcela_numero}/${l.parcela_total})` : l.descricao),
      ROTULO_TIPO[l.tipo],
      celula(l.categoria),
      celula(l.conta),
      celula(l.conta_destino),
      (l.tipo === 'despesa' ? '-' : '') + (l.valor / 100).toFixed(2).replace('.', ','),
    ].join(';'));
    // BOM no início: é como o Excel reconhece o arquivo como UTF-8.
    return `﻿${['Data;Descrição;Tipo;Categoria;Conta;Conta destino;Valor', ...linhas].join('\r\n')}\r\n`;
  }

  // ---- gravações

  /** Inclui ou altera uma conta bancária ou um cartão de crédito (tipo "cartao"). */
  async function salvarConta(dados, id) {
    const atual = id === undefined ? null : exigir('contas', id);
    const registro = normalizarConta(dados);
    const cartao = registro.tipo === 'cartao';
    if (atual && (atual.tipo === 'cartao') !== cartao) {
      throw new Erro('Uma conta não pode virar cartão, nem um cartão virar conta. Cadastre um novo.');
    }
    if (mem.contas.some((c) => c.id !== id && mesmoNome(c.nome, registro.nome))) {
      throw new Erro('Já existe uma conta ou um cartão com esse nome.');
    }
    if (registro.conta_pagamento_id !== null) {
      const pagadora = buscar('contas', registro.conta_pagamento_id);
      if (!pagadora || pagadora.tipo === 'cartao') {
        throw new Erro('Escolha uma conta bancária para pagar a fatura.');
      }
    }
    return gravar('contas', registro, id);
  }

  async function excluirConta(id) {
    const conta = exigir('contas', id);
    if (mem.lancamentos.some((l) => l.conta_id === id || l.conta_destino_id === id)) {
      throw new Erro(conta.tipo === 'cartao'
        ? 'Este cartão tem lançamentos. Arquive-o em vez de excluir.'
        : 'Esta conta tem lançamentos. Arquive-a em vez de excluir.');
    }
    await escrever((em) => {
      em('contas').delete(id);
      // Cartões que pagavam a fatura por esta conta ficam sem conta de pagamento.
      for (const c of mem.contas) {
        if (c.conta_pagamento_id === id) em('contas').put({ ...c, conta_pagamento_id: null });
      }
    });
  }

  // Na edição só o nome muda: trocar o tipo deixaria lançamentos existentes incoerentes.
  async function salvarCategoria(dados, id) {
    const tipo = id === undefined ? dados?.tipo : exigir('categorias', id).tipo;
    const nome = texto(dados?.nome, 'Informe o nome da categoria.', 60);
    if (!TIPOS_CATEGORIA.includes(tipo)) throw new Erro('Tipo de categoria inválido.');
    if (mem.categorias.some((c) => c.id !== id && c.tipo === tipo && mesmoNome(c.nome, nome))) {
      throw new Erro('Já existe uma categoria com esse nome.');
    }
    return gravar('categorias', { nome, tipo }, id);
  }

  async function excluirCategoria(id) {
    exigir('categorias', id);
    const usos = mem.lancamentos.filter((l) => l.categoria_id === id).length;
    if (usos) throw new Erro(`Esta categoria está em uso em ${usos} lançamento(s).`);
    await escrever((em) => {
      em('categorias').delete(id);
      for (const o of mem.orcamentos) if (o.categoria_id === id) em('orcamentos').delete([id, o.mes]);
    });
  }

  function validarLancamento(dados) {
    if (!TIPOS_LANCAMENTO.includes(dados?.tipo)) throw new Erro('Tipo de lançamento inválido.');
    if (!dataValida(dados.data)) throw new Erro('Informe uma data válida.');
    const registro = {
      data: dados.data,
      descricao: texto(dados.descricao, 'Informe a descrição.', 200),
      valor: centavos(dados.valor),
      tipo: dados.tipo,
      conta_id: dados.conta_id,
      conta_destino_id: null,
      categoria_id: null,
      ...SEM_PARCELA,
    };
    if (!buscar('contas', dados.conta_id)) throw new Erro('Selecione a conta.');
    if (dados.tipo === 'transferencia') {
      if (!buscar('contas', dados.conta_destino_id)) throw new Erro('Selecione a conta de destino.');
      if (dados.conta_destino_id === dados.conta_id) {
        throw new Erro('A conta de destino deve ser diferente da conta de origem.');
      }
      registro.conta_destino_id = dados.conta_destino_id;
    } else if (dados.categoria_id !== null && dados.categoria_id !== undefined) {
      if (buscar('categorias', dados.categoria_id)?.tipo !== dados.tipo) {
        throw new Erro('Categoria inválida para este tipo de lançamento.');
      }
      registro.categoria_id = dados.categoria_id;
    }
    return registro;
  }

  /**
   * Inclui ou altera um lançamento. Ao incluir uma despesa em cartão de crédito,
   * dados.parcelas (2 ou mais) divide o valor em uma parcela por mês a partir da data.
   * Devolve o id do lançamento (o da primeira parcela, quando parcelado).
   */
  async function salvarLancamento(dados, id) {
    const atual = id === undefined ? null : exigir('lancamentos', id);
    const registro = validarLancamento(dados);
    if (atual) {
      // Editar uma parcela muda só ela; ela continua pertencendo à mesma compra.
      const { parcela_numero, parcela_total, parcela_grupo } = atual;
      return gravar('lancamentos', { ...registro, parcela_numero, parcela_total, parcela_grupo }, id);
    }
    const parcelas = dados.parcelas ?? 1;
    if (!Number.isInteger(parcelas) || parcelas < 1 || parcelas > MAX_PARCELAS) {
      throw new Erro(`O número de parcelas deve ficar entre 1 e ${MAX_PARCELAS}.`);
    }
    if (parcelas === 1) return gravar('lancamentos', registro);
    if (registro.tipo !== 'despesa' || buscar('contas', registro.conta_id).tipo !== 'cartao') {
      throw new Erro('Só despesas no cartão de crédito podem ser parceladas.');
    }
    if (registro.valor < parcelas) throw new Erro('O valor é pequeno demais para esse número de parcelas.');

    const base = Math.floor(registro.valor / parcelas);
    const grupo = crypto.randomUUID();
    let primeira;
    // Todas as parcelas na mesma transação: ou a compra inteira é gravada, ou nada.
    await escrever((em) => {
      for (let numero = 1; numero <= parcelas; numero += 1) {
        const pedido = em('lancamentos').add({
          ...registro,
          data: somarMesesNaData(registro.data, numero - 1),
          // Os centavos que sobram da divisão ficam na primeira parcela.
          valor: numero === 1 ? registro.valor - base * (parcelas - 1) : base,
          parcela_numero: numero,
          parcela_total: parcelas,
          parcela_grupo: grupo,
        });
        if (numero === 1) pedido.onsuccess = (ev) => { primeira = ev.target.result; };
      }
    });
    return primeira;
  }

  /** Exclui todas as parcelas que restam de uma compra parcelada; devolve quantas eram. */
  async function excluirParcelas(grupo) {
    const parcelas = mem.lancamentos.filter((l) => l.parcela_grupo !== null && l.parcela_grupo === grupo);
    if (!parcelas.length) throw new Erro('Compra parcelada não encontrada.');
    await escrever((em) => {
      for (const l of parcelas) em('lancamentos').delete(l.id);
    });
    return parcelas.length;
  }

  async function excluirLancamento(id) {
    exigir('lancamentos', id);
    await escrever((em) => em('lancamentos').delete(id));
  }

  /**
   * Define o limite da categoria a partir do mês informado (limite nulo = sem limite).
   * Vale para esse mês e todos os seguintes; os meses anteriores não mudam.
   */
  async function definirOrcamento(categoriaId, mes, limite) {
    if (exigir('categorias', categoriaId).tipo !== 'despesa') {
      throw new Erro('Só categorias de despesa têm orçamento.');
    }
    exigirMes(mes);
    const valor = limite === null ? null : centavos(limite, 'Informe um limite maior que zero.');
    const anterior = limitesEm(somarMeses(mes, -1)).get(categoriaId) ?? null;
    await escrever((em) => {
      // Mudanças já feitas deste mês em diante saem: o novo valor passa a valer para todos eles.
      for (const o of mem.orcamentos) {
        if (o.categoria_id === categoriaId && o.mes >= mes) em('orcamentos').delete([categoriaId, o.mes]);
      }
      // Igual ao que já vinha valendo não é mudança; não precisa de registro.
      if (valor !== anterior) em('orcamentos').put({ categoria_id: categoriaId, mes, limite: valor });
    });
  }

  // ---- backup

  function exportar() {
    return { formato: FORMATO_BACKUP, versao: VERSAO_BACKUP, exportado_em: new Date().toISOString(), ...mem };
  }

  /** Substitui todos os dados deste aparelho pelo conteúdo do backup. */
  async function importar(backup) {
    const dados = validarBackup(backup);
    // Uma transação só: se algo falhar no meio, os dados atuais continuam intactos.
    await escrever((em) => {
      for (const loja of LOJAS) {
        em(loja).clear();
        for (const registro of dados[loja]) em(loja).put(registro);
      }
    });
  }

  await recarregar();
  return {
    contas, categorias, lancamentos, orcamentos, resumo, csv, fatura, faturasDoCartao,
    salvarConta, excluirConta, salvarCategoria, excluirCategoria,
    salvarLancamento, excluirLancamento, excluirParcelas, definirOrcamento,
    exportar, importar,
    fechar: () => idb.close(),
  };
}
