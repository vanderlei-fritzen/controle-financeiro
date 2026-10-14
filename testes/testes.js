// Testes dos dados e das regras. Abra /testes/ no navegador para rodar.
// Cada teste usa um banco IndexedDB próprio, apagado ao final.

import {
  Erro, abrirBanco, datasDaFatura, hojeISO, mesDaFatura, somarMeses, somarMesesNaData, validarBackup,
} from '../dados.js';

const HOJE = hojeISO();
const MES = HOJE.slice(0, 7);
const testes = [];
const teste = (nome, corpo) => testes.push([nome, corpo]);

// Compara pelo conteúdo: a ordem das chaves de um objeto não importa, a de uma lista sim.
function canonico(valor) {
  if (Array.isArray(valor)) return valor.map(canonico);
  if (valor && typeof valor === 'object') {
    return Object.fromEntries(Object.keys(valor).sort().map((chave) => [chave, canonico(valor[chave])]));
  }
  return valor;
}

function igual(obtido, esperado, oQue = 'valor') {
  const [a, b] = [JSON.stringify(canonico(obtido)), JSON.stringify(canonico(esperado))];
  if (a !== b) throw new Error(`${oQue}: obtido ${a}, esperado ${b}`);
}

// A ação deve ser recusada com um Erro de regra (e não com uma falha qualquer).
async function recusa(acao, trecho = '') {
  try {
    await acao();
  } catch (erro) {
    if (!(erro instanceof Erro)) throw erro;
    if (!erro.message.includes(trecho)) throw new Error(`mensagem inesperada: ${erro.message}`);
    return;
  }
  throw new Error(`deveria ter sido recusado${trecho ? ` (${trecho})` : ''}`);
}

// Banco novo com atalhos para os registros iniciais.
async function preparar(nome) {
  const b = await abrirBanco(nome);
  const id = (lista, nomeBuscado) => lista.find((item) => item.nome === nomeBuscado).id;
  const carteira = id(b.contas(), 'Carteira');
  const corrente = id(b.contas(), 'Conta corrente');
  const cat = (nomeCategoria) => id(b.categorias(), nomeCategoria);
  const lancar = (tipo, valor, campos = {}) => b.salvarLancamento(
    { tipo, valor, data: HOJE, descricao: 'Teste', conta_id: corrente, ...campos });
  const saldos = () => Object.fromEntries(b.contas().map((c) => [c.nome, c.saldo]));
  return { b, carteira, corrente, cat, lancar, saldos };
}

function dataRelativa(dias) {
  const d = new Date();
  d.setDate(d.getDate() + dias);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

teste('banco novo vem com contas e categorias', async ({ b, saldos }) => {
  igual(saldos(), { Carteira: 0, 'Conta corrente': 0 }, 'saldos');
  igual(b.categorias().length, 12, 'categorias');
  igual(b.resumo(MES).total_lancamentos, 0, 'lançamentos');
});

teste('saldo soma receitas, despesas e transferências', async ({ b, corrente, carteira, lancar, saldos }) => {
  await b.salvarConta({ nome: 'Conta corrente', tipo: 'corrente', saldo_inicial: 100_00 }, corrente);
  await lancar('receita', 500_00);
  await lancar('despesa', 120_50);
  await lancar('transferencia', 80_00, { conta_destino_id: carteira });
  igual(saldos(), { Carteira: 80_00, 'Conta corrente': 399_50 });
});

teste('lançamento futuro não entra no saldo, mas entra no mês', async ({ b, lancar, saldos }) => {
  const amanha = dataRelativa(1);
  await lancar('despesa', 50_00, { data: amanha });
  igual(saldos()['Conta corrente'], 0, 'saldo');
  const resumo = b.resumo(amanha.slice(0, 7));
  igual([resumo.despesas, resumo.saldo_total], [50_00, 0], 'resumo');
});

teste('validações de lançamento', async ({ b, corrente, cat, lancar }) => {
  const invalidos = [
    { valor: 0 }, { valor: -5 }, { valor: 10.5 }, { valor: '100' },
    { data: '31/12/2026' }, { data: '2026-02-30' }, { descricao: '   ' },
    { conta_id: 9999 }, { conta_id: String(corrente) },
    { categoria_id: cat('Salário') }, // categoria de receita em uma despesa
  ];
  for (const campos of invalidos) {
    await recusa(() => lancar('despesa', campos.valor ?? 10_00, campos));
  }
  await recusa(() => lancar('transferencia', 10_00, { conta_destino_id: corrente }), 'diferente');
  await recusa(() => lancar('doacao', 10_00), 'Tipo');
  igual(b.lancamentos({ mes: MES }), [], 'nada foi gravado');
});

teste('editar e excluir lançamento', async ({ b, carteira, cat, lancar, saldos }) => {
  const id = await lancar('despesa', 30_00);
  await b.salvarLancamento({
    tipo: 'receita', valor: 45_00, data: HOJE, descricao: ' Corrigido ', conta_id: carteira, categoria_id: cat('Salário'),
  }, id);
  const [l] = b.lancamentos({ mes: MES });
  igual([l.id, l.descricao, l.categoria, l.conta], [id, 'Corrigido', 'Salário', 'Carteira']);
  igual(saldos(), { Carteira: 45_00, 'Conta corrente': 0 });
  await b.excluirLancamento(id);
  await recusa(() => b.excluirLancamento(id), 'não encontrado');
});

teste('filtros e ordem da lista', async ({ b, carteira, cat, lancar }) => {
  await lancar('despesa', 10_00, { descricao: 'Farmácia 100%', categoria_id: cat('Saúde'), data: dataRelativa(0) });
  await lancar('despesa', 20_00, { descricao: 'Ônibus', conta_id: carteira });
  await lancar('receita', 30_00, { descricao: 'Salário' });
  const descricoes = (filtros) => b.lancamentos({ mes: MES, ...filtros }).map((l) => l.descricao);
  igual(descricoes({}), ['Salário', 'Ônibus', 'Farmácia 100%'], 'mais recente primeiro');
  igual(descricoes({ tipo: 'despesa' }), ['Ônibus', 'Farmácia 100%'], 'tipo');
  igual(descricoes({ conta_id: carteira }), ['Ônibus'], 'conta');
  igual(descricoes({ categoria_id: cat('Saúde') }), ['Farmácia 100%'], 'categoria');
  igual(descricoes({ q: 'farmacia' }), ['Farmácia 100%'], 'busca sem acento');
  igual(descricoes({ q: 'ONIBUS' }), ['Ônibus'], 'busca sem maiúsculas');
  igual(descricoes({ q: '%' }), ['Farmácia 100%'], 'busca literal');
  await recusa(() => b.lancamentos({ mes: '2026-13' }), 'Mês inválido');
});

teste('resumo do mês', async ({ b, carteira, cat, lancar }) => {
  const mesPassado = somarMeses(MES, -1);
  await lancar('receita', 3000_00, { categoria_id: cat('Salário') });
  await lancar('despesa', 800_00, { categoria_id: cat('Moradia') });
  await lancar('despesa', 200_00, { categoria_id: cat('Lazer') });
  await lancar('despesa', 50_00); // sem categoria
  await lancar('transferencia', 999_00, { conta_destino_id: carteira }); // fora dos totais
  await lancar('despesa', 400_00, { data: `${mesPassado}-01` });
  await b.definirOrcamento(cat('Lazer'), MES, 150_00);

  const r = b.resumo(MES);
  igual([r.receitas, r.despesas], [3000_00, 1050_00], 'totais');
  igual(r.saldo_total, 3000_00 - 1050_00 - 400_00, 'saldo total');
  igual(r.por_categoria.map((c) => [c.nome, c.total]),
    [['Moradia', 800_00], ['Lazer', 200_00], ['Sem categoria', 50_00]], 'por categoria');
  igual(r.historico.length, 6, 'meses no histórico');
  igual(r.historico[5], { mes: MES, receitas: 3000_00, despesas: 1050_00 }, 'mês atual');
  igual(r.historico[4], { mes: mesPassado, receitas: 0, despesas: 400_00 }, 'mês anterior');
  igual(r.orcamentos, [{ categoria_id: cat('Lazer'), nome: 'Lazer', limite: 150_00, gasto: 200_00 }], 'orçamento');
  igual(r.total_lancamentos, 6, 'total de lançamentos');
});

teste('orçamento: validações', async ({ b, cat }) => {
  await recusa(() => b.definirOrcamento(cat('Lazer'), MES, 0), 'maior que zero');
  await recusa(() => b.definirOrcamento(cat('Lazer'), '2026-13', 100), 'Mês inválido');
  await recusa(() => b.definirOrcamento(cat('Salário'), MES, 10), 'despesa');
  await recusa(() => b.definirOrcamento(999, MES, 10), 'não encontrado');
  igual(b.exportar().orcamentos, [], 'nada foi gravado');
});

teste('orçamento vale do mês alterado em diante, sem mexer nos anteriores', async ({ b, cat }) => {
  const lazer = cat('Lazer');
  const [set, out, nov, dez, jan] = ['2026-09', '2026-10', '2026-11', '2026-12', '2027-01'];
  const limites = (...meses) => meses.map((mes) => b.orcamentos(mes).find((o) => o.categoria_id === lazer).limite);
  const mudancas = () => b.exportar().orcamentos.map((o) => [o.mes, o.limite]).sort();

  await b.definirOrcamento(lazer, out, 1000_00);
  igual(limites(set, out, nov, jan), [null, 1000_00, 1000_00, 1000_00], 'vale para os meses seguintes');

  await b.definirOrcamento(lazer, nov, 1200_00);
  igual(limites(set, out, nov, dez, jan), [null, 1000_00, 1200_00, 1200_00, 1200_00], 'outubro mantém o valor');

  await b.definirOrcamento(lazer, dez, null);
  igual(limites(out, nov, dez, jan), [1000_00, 1200_00, null, null], 'remover também só vale dali em diante');

  await b.definirOrcamento(lazer, out, 900_00);
  igual(limites(set, out, nov, dez, jan), [null, 900_00, 900_00, 900_00, 900_00], 'substitui as mudanças posteriores');
  igual(mudancas(), [[out, 900_00]], 'histórico enxuto');

  await b.definirOrcamento(lazer, nov, 900_00);
  igual(mudancas(), [[out, 900_00]], 'repetir o valor vigente não cria mudança');

  await b.definirOrcamento(lazer, out, null);
  igual([limites(out, nov), mudancas()], [[null, null], []], 'voltar a sem limite limpa o histórico');

  // Outras categorias têm histórico próprio.
  await b.definirOrcamento(cat('Saúde'), nov, 500_00);
  await b.definirOrcamento(lazer, out, 300_00);
  igual(b.resumo(out).orcamentos.map((o) => [o.nome, o.limite]), [['Lazer', 300_00]], 'resumo de outubro');
  igual(b.resumo(nov).orcamentos.map((o) => [o.nome, o.limite]), [['Lazer', 300_00], ['Saúde', 500_00]], 'resumo de novembro');
});

teste('banco da versão anterior: os limites existentes continuam em todos os meses', async (_contexto, nome) => {
  const antigo = `${nome}-v1`;
  // Banco no formato antigo, com um limite por categoria e sem mês.
  await new Promise((ok, falha) => {
    const pedido = indexedDB.open(antigo, 1);
    pedido.onupgradeneeded = () => {
      const idb = pedido.result;
      idb.createObjectStore('contas', { keyPath: 'id', autoIncrement: true })
        .add({ nome: 'Carteira', tipo: 'carteira', saldo_inicial: 0, arquivada: false });
      idb.createObjectStore('categorias', { keyPath: 'id', autoIncrement: true }).add({ nome: 'Lazer', tipo: 'despesa' });
      idb.createObjectStore('lancamentos', { keyPath: 'id', autoIncrement: true })
        .add({ data: HOJE, descricao: 'Cinema', valor: 40_00, tipo: 'despesa', conta_id: 1, conta_destino_id: null, categoria_id: 1 });
      idb.createObjectStore('orcamentos', { keyPath: 'categoria_id' }).add({ categoria_id: 1, limite: 300_00 });
    };
    pedido.onsuccess = () => { pedido.result.close(); ok(); };
    pedido.onerror = () => falha(pedido.error);
  });
  const b = await abrirBanco(antigo);
  try {
    const limite = (mes) => b.orcamentos(mes)[0].limite;
    igual([limite('2020-01'), limite(MES), limite(somarMeses(MES, 12))], [300_00, 300_00, 300_00], 'antes da mudança');
    igual(b.lancamentos({ mes: MES }).map((l) => l.descricao), ['Cinema'], 'lançamentos preservados');
    const [conta] = b.contas();
    igual([conta.banco, conta.agencia, conta.limite, conta.conta_pagamento_id], ['', '', null, null], 'campos novos da conta');
    await b.definirOrcamento(1, MES, 450_00);
    igual([limite(somarMeses(MES, -1)), limite(MES)], [300_00, 450_00], 'depois da mudança');
  } finally {
    b.fechar();
    indexedDB.deleteDatabase(antigo);
  }
});

teste('conta e categoria em uso não são excluídas', async ({ b, corrente, carteira, cat, lancar }) => {
  await lancar('despesa', 10_00, { categoria_id: cat('Moradia') });
  await recusa(() => b.excluirConta(corrente), 'Arquive');
  await recusa(() => b.excluirCategoria(cat('Moradia')), 'em uso');
  await b.definirOrcamento(cat('Lazer'), somarMeses(MES, -1), 100_00);
  await b.definirOrcamento(cat('Lazer'), MES, 200_00);
  await b.excluirConta(carteira);
  await b.excluirCategoria(cat('Lazer'));
  igual(b.contas().length, 1, 'contas');
  igual(b.exportar().orcamentos, [], 'o orçamento sai junto com a categoria');
});

teste('nomes duplicados', async ({ b, carteira }) => {
  await recusa(() => b.salvarConta({ nome: 'carteira', tipo: 'carteira' }), 'Já existe');
  await recusa(() => b.salvarCategoria({ nome: 'MORADIA', tipo: 'despesa' }), 'Já existe');
  await b.salvarCategoria({ nome: 'Moradia', tipo: 'receita' }); // mesmo nome, outro tipo
  await b.salvarConta({ nome: 'Carteira', tipo: 'carteira', saldo_inicial: 5 }, carteira); // regravar a si mesma
  await recusa(() => b.salvarConta({ nome: 'Banco', tipo: 'cofre' }), 'Tipo');
});

teste('conta arquivada sai do saldo total', async ({ b, carteira, lancar }) => {
  await lancar('receita', 100_00, { conta_id: carteira });
  await b.salvarConta({ nome: 'Carteira', tipo: 'carteira', saldo_inicial: 0, arquivada: true }, carteira);
  igual(b.resumo(MES).saldo_total, 0);
  igual(b.contas().map((c) => c.nome), ['Conta corrente', 'Carteira'], 'arquivadas por último');
});

teste('cartão de crédito: compras ficam em aberto e pagar a fatura não é despesa de novo', async ({ b, corrente, cat, lancar }) => {
  const cartao = await b.salvarConta({
    nome: 'Cartão Azul', tipo: 'cartao', banco: ' Banco X ', bandeira: 'visa', numero: '1234', limite: 5000_00,
    dia_fechamento: 25, dia_vencimento: 5, conta_pagamento_id: corrente, saldo_inicial: -200_00,
  });
  const ver = () => b.contas().find((c) => c.id === cartao);
  igual([ver().banco, ver().bandeira, ver().numero, ver().limite, ver().dia_fechamento, ver().dia_vencimento, ver().conta_pagamento_id],
    ['Banco X', 'visa', '1234', 5000_00, 25, 5, corrente], 'cadastro');

  await lancar('receita', 3000_00);
  await lancar('despesa', 450_00, { conta_id: cartao, categoria_id: cat('Lazer') });
  let r = b.resumo(MES);
  igual([ver().saldo, r.saldo_total, r.cartoes_em_aberto, r.despesas], [-650_00, 3000_00, 650_00, 450_00],
    'a compra é despesa do mês e fica em aberto, sem mexer no saldo das contas');

  await lancar('transferencia', 650_00, { conta_destino_id: cartao });
  r = b.resumo(MES);
  igual([ver().saldo, r.saldo_total, r.cartoes_em_aberto, r.despesas], [0, 2350_00, 0, 450_00],
    'pagar a fatura baixa o saldo da conta e zera o cartão');
});

teste('cartão de crédito e conta bancária: validações do cadastro', async ({ b, corrente, carteira }) => {
  const base = { nome: 'Cartão', tipo: 'cartao' };
  await recusa(() => b.salvarConta({ ...base, numero: '12345678' }), '4 últimos');
  await recusa(() => b.salvarConta({ ...base, bandeira: 'diners' }), 'Bandeira');
  await recusa(() => b.salvarConta({ ...base, limite: 0 }), 'limite');
  await recusa(() => b.salvarConta({ ...base, dia_fechamento: 32 }), 'fechamento');
  await recusa(() => b.salvarConta({ ...base, dia_vencimento: 0 }), 'vencimento');
  await recusa(() => b.salvarConta({ ...base, dia_vencimento: 5.5 }), 'vencimento');
  await recusa(() => b.salvarConta({ ...base, conta_pagamento_id: 999 }), 'conta bancária');
  await recusa(() => b.salvarConta({ ...base, nome: '  ' }), 'nome do cartão');
  const cartao = await b.salvarConta(base);
  await recusa(() => b.salvarConta({ nome: 'Outro', tipo: 'cartao', conta_pagamento_id: cartao }), 'conta bancária');
  await recusa(() => b.salvarConta({ nome: 'Cartão', tipo: 'corrente' }, cartao), 'não pode virar');
  await recusa(() => b.salvarConta({ nome: 'Carteira', tipo: 'cartao' }, carteira), 'não pode virar');
  await recusa(() => b.salvarConta({ nome: 'cartão', tipo: 'corrente' }), 'Já existe');
  await recusa(() => b.salvarConta({ nome: 'Banco', tipo: 'corrente', agencia: 'x'.repeat(21) }), 'máximo');

  // Campos próprios de cartão informados em uma conta bancária são ignorados.
  await b.salvarConta({
    nome: 'Conta corrente', tipo: 'corrente', banco: 'Banco Y', agencia: ' 0001 ', numero: '12345-6',
    limite: 100, bandeira: 'visa', dia_fechamento: 9,
  }, corrente);
  const conta = b.contas().find((c) => c.id === corrente);
  igual([conta.banco, conta.agencia, conta.numero, conta.limite, conta.bandeira, conta.dia_fechamento],
    ['Banco Y', '0001', '12345-6', null, '', null]);
});

teste('excluir a conta que pagava a fatura solta o vínculo do cartão', async ({ b, carteira }) => {
  const cartao = await b.salvarConta({ nome: 'Cartão', tipo: 'cartao', conta_pagamento_id: carteira });
  await b.excluirConta(carteira);
  igual(b.contas().find((c) => c.id === cartao).conta_pagamento_id, null);
  await b.excluirConta(cartao);
  igual(b.contas().map((c) => c.nome), ['Conta corrente']);
});

teste('compra parcelada no cartão gera uma parcela por mês', async ({ b, cat }) => {
  const cartao = await b.salvarConta({ nome: 'Cartão', tipo: 'cartao', limite: 5000_00 });
  const primeira = await b.salvarLancamento({
    tipo: 'despesa', valor: 1000_00, data: HOJE, descricao: 'Notebook', conta_id: cartao, categoria_id: cat('Lazer'), parcelas: 3,
  });
  const parcelas = b.exportar().lancamentos;
  igual(parcelas.map((l) => [l.parcela_numero, l.parcela_total, l.valor, l.data]), [
    [1, 3, 333_34, HOJE], [2, 3, 333_33, somarMesesNaData(HOJE, 1)], [3, 3, 333_33, somarMesesNaData(HOJE, 2)],
  ], 'os centavos que sobram ficam na primeira parcela');
  igual(parcelas[0].id, primeira, 'devolve a primeira parcela');
  igual(new Set(parcelas.map((l) => l.parcela_grupo)).size, 1, 'todas pertencem à mesma compra');
  igual(parcelas.every((l) => l.descricao === 'Notebook' && l.categoria_id === cat('Lazer') && l.conta_id === cartao), true,
    'descrição, categoria e cartão iguais em todas');

  igual([0, 1, 2, 3].map((n) => b.resumo(somarMeses(MES, n)).despesas), [333_34, 333_33, 333_33, 0],
    'cada parcela é despesa do seu mês');
  igual(b.orcamentos(somarMeses(MES, 1)).find((o) => o.nome === 'Lazer').gasto, 333_33, 'e entra no orçamento do seu mês');
  const cadastro = b.contas().find((c) => c.id === cartao);
  igual([cadastro.saldo, cadastro.saldo_previsto], [-333_34, -1000_00],
    'em aberto só a parcela de hoje; o limite considera a compra inteira');
  igual(b.csv({ mes: MES }).includes(';Notebook (1/3);Despesa;'), true, 'CSV mostra a parcela');
});

teste('parcelas: divisão exata, datas no fim do mês e validações', async ({ b, corrente }) => {
  const cartao = await b.salvarConta({ nome: 'Cartão', tipo: 'cartao' });
  const compra = (campos) => b.salvarLancamento(
    { tipo: 'despesa', valor: 300_00, data: '2027-01-31', descricao: 'Compra', conta_id: cartao, ...campos });
  await compra({ parcelas: 4 });
  igual(b.exportar().lancamentos.map((l) => [l.data, l.valor]),
    [['2027-01-31', 75_00], ['2027-02-28', 75_00], ['2027-03-31', 75_00], ['2027-04-30', 75_00]],
    'o dia recua quando o mês é mais curto');
  igual([somarMesesNaData('2028-01-31', 1), somarMesesNaData('2026-12-15', 1), somarMesesNaData('2026-10-05', 14)],
    ['2028-02-29', '2027-01-15', '2027-12-05'], 'ano bissexto e virada de ano');

  await recusa(() => compra({ parcelas: 0 }), 'parcelas');
  await recusa(() => compra({ parcelas: 49 }), 'parcelas');
  await recusa(() => compra({ parcelas: 2.5 }), 'parcelas');
  await recusa(() => compra({ parcelas: '3' }), 'parcelas');
  await recusa(() => compra({ parcelas: 3, conta_id: corrente }), 'cartão de crédito');
  await recusa(() => compra({ parcelas: 3, tipo: 'receita' }), 'cartão de crédito');
  await recusa(() => compra({ parcelas: 3, valor: 2 }), 'pequeno demais');
  igual(b.exportar().lancamentos.length, 4, 'nenhuma das recusadas gravou parcelas');

  const aVista = await compra({ parcelas: 1 });
  const comum = b.exportar().lancamentos.find((l) => l.id === aVista);
  igual([comum.parcela_numero, comum.parcela_total, comum.parcela_grupo], [null, null, null], 'uma parcela é um lançamento comum');
});

teste('parcelas: editar muda só uma; excluir uma ou a compra inteira', async ({ b }) => {
  const cartao = await b.salvarConta({ nome: 'Cartão', tipo: 'cartao' });
  const base = { tipo: 'despesa', valor: 600_00, data: HOJE, descricao: 'Sofá', conta_id: cartao };
  await b.salvarLancamento({ ...base, parcelas: 6 });
  await b.salvarLancamento({ ...base, descricao: 'Outra compra', parcelas: 2 });
  const doSofa = () => b.exportar().lancamentos.filter((l) => l.descricao.startsWith('Sofá'));

  const segunda = doSofa()[1];
  await b.salvarLancamento({ ...base, valor: 90_00, descricao: 'Sofá (ajustada)', data: segunda.data, parcelas: 12 }, segunda.id);
  const editada = doSofa()[1];
  igual([editada.valor, editada.parcela_numero, editada.parcela_total, editada.parcela_grupo === segunda.parcela_grupo],
    [90_00, 2, 6, true], 'a parcela editada continua na mesma compra');
  igual(doSofa().map((l) => l.valor), [100_00, 90_00, 100_00, 100_00, 100_00, 100_00], 'as outras não mudam, nem surgem novas');

  await b.excluirLancamento(doSofa()[0].id);
  igual(doSofa().map((l) => l.parcela_numero), [2, 3, 4, 5, 6], 'excluir uma parcela');
  igual(await b.excluirParcelas(segunda.parcela_grupo), 5, 'excluir as que restam');
  igual(b.exportar().lancamentos.map((l) => l.descricao), ['Outra compra', 'Outra compra'], 'a outra compra fica');
  await recusa(() => b.excluirParcelas(segunda.parcela_grupo), 'não encontrada');
  await recusa(() => b.excluirParcelas(null), 'não encontrada'); // nulo não pode casar com os lançamentos comuns
});

teste('fatura: em que fatura cai cada compra', async () => {
  // Fecha depois do dia do vencimento: a fatura fecha no mês anterior ao do vencimento.
  const fim = { dia_fechamento: 25, dia_vencimento: 5 };
  igual(datasDaFatura(fim, '2026-11'), { fechamento: '2026-10-25', vencimento: '2026-11-05' });
  igual(['2026-09-25', '2026-10-12', '2026-10-24', '2026-10-25', '2026-12-31'].map((d) => mesDaFatura(fim, d)),
    ['2026-11', '2026-11', '2026-11', '2026-12', '2027-02'], 'a compra no dia do fechamento já é da fatura seguinte');

  // Fecha antes do dia do vencimento: fechamento e vencimento no mesmo mês.
  const inicio = { dia_fechamento: 5, dia_vencimento: 15 };
  igual(datasDaFatura(inicio, '2026-11'), { fechamento: '2026-11-05', vencimento: '2026-11-15' });
  igual(['2026-10-04', '2026-10-05', '2026-11-04', '2026-11-05'].map((d) => mesDaFatura(inicio, d)),
    ['2026-10', '2026-11', '2026-11', '2026-12']);

  // Dia 31 em mês curto recua para o último dia, sem deixar buraco entre as faturas.
  const dia31 = { dia_fechamento: 31, dia_vencimento: 10 };
  igual([datasDaFatura(dia31, '2027-03').fechamento, datasDaFatura(dia31, '2028-03').fechamento], ['2027-02-28', '2028-02-29']);
  igual(['2027-01-31', '2027-02-27', '2027-02-28', '2027-03-30', '2027-03-31'].map((d) => mesDaFatura(dia31, d)),
    ['2027-03', '2027-03', '2027-04', '2027-04', '2027-05']);
});

teste('fatura: total, período e situação ao longo do tempo', async ({ b, corrente, cat }) => {
  const cartao = await b.salvarConta({ nome: 'Cartão', tipo: 'cartao', dia_fechamento: 25, dia_vencimento: 5 });
  const lancar = (tipo, valor, data, campos = {}) => b.salvarLancamento(
    { tipo, valor, data, descricao: 'Teste', conta_id: cartao, ...campos });
  await lancar('despesa', 100_00, '2026-10-10', { categoria_id: cat('Lazer'), descricao: 'Jantar' });
  await lancar('despesa', 50_00, '2026-10-24');
  await lancar('receita', 20_00, '2026-10-15', { descricao: 'Estorno' });
  await lancar('despesa', 30_00, '2026-10-25'); // dia do fechamento: fatura de dezembro
  await lancar('despesa', 300_00, '2026-10-28', { parcelas: 3 }); // dezembro, janeiro e fevereiro

  const nov = (hoje) => b.fatura(cartao, '2026-11', hoje);
  const f = nov('2026-10-20');
  igual([f.inicio, f.fim, f.fechamento, f.vencimento], ['2026-09-25', '2026-10-24', '2026-10-25', '2026-11-05'], 'período');
  igual([f.total, f.pago, f.restante, f.saldo_anterior, f.estado], [130_00, 0, 130_00, 0, 'aberta'], 'estorno desconta do total');
  igual(f.lancamentos.map((l) => [l.data, l.descricao, l.categoria]),
    [['2026-10-24', 'Teste', null], ['2026-10-15', 'Estorno', null], ['2026-10-10', 'Jantar', 'Lazer']], 'lançamentos, do mais recente');
  igual([nov('2026-09-24').estado, nov('2026-10-24').estado, nov('2026-10-25').estado, nov('2026-11-05').estado, nov('2026-11-06').estado],
    ['futura', 'aberta', 'fechada', 'fechada', 'vencida'], 'situação conforme a data');

  igual(['2026-12', '2027-01', '2027-02', '2027-03'].map((mes) => b.fatura(cartao, mes, '2026-10-30').total),
    [130_00, 100_00, 100_00, 0], 'cada parcela entra na fatura do seu mês');
  igual(b.fatura(cartao, '2027-03', '2027-03-01').estado, 'zerada', 'fatura sem lançamentos');

  // Pagamento parcial: o resto fica na fatura e passa como saldo anterior para a seguinte.
  await b.salvarLancamento({ tipo: 'transferencia', valor: 100_00, data: '2026-11-03', descricao: 'Pagamento', conta_id: corrente, conta_destino_id: cartao });
  igual(nov('2026-11-02').pago, 0, 'pagamento com data futura ainda não conta');
  const parcial = nov('2026-11-06');
  igual([parcial.pago, parcial.restante, parcial.estado], [100_00, 30_00, 'vencida'], 'pagamento parcial');
  const dez = b.fatura(cartao, '2026-12', '2026-11-06');
  igual([dez.total, dez.pago, dez.saldo_anterior, dez.estado], [130_00, 0, 30_00, 'aberta'], 'a seguinte carrega o que faltou');

  // O pagamento seguinte quita primeiro o resto da fatura mais antiga.
  await b.salvarLancamento({ tipo: 'transferencia', valor: 80_00, data: '2026-11-10', descricao: 'Pagamento', conta_id: corrente, conta_destino_id: cartao });
  igual([nov('2026-11-10').restante, nov('2026-11-10').estado], [0, 'paga'], 'fatura quitada');
  const dezDepois = b.fatura(cartao, '2026-12', '2026-11-10');
  igual([dezDepois.pago, dezDepois.restante, dezDepois.saldo_anterior], [50_00, 80_00, 0], 'o que sobra do pagamento vai para a seguinte');
});

teste('fatura: resumo do cartão e dívida informada no cadastro', async ({ b, corrente }) => {
  const cartao = await b.salvarConta({ nome: 'Cartão', tipo: 'cartao', dia_fechamento: 5, dia_vencimento: 15, saldo_inicial: -200_00 });
  const compra = (valor, data) => b.salvarLancamento({ tipo: 'despesa', valor, data, descricao: 'Compra', conta_id: cartao });
  const pagar = (valor, data) => b.salvarLancamento(
    { tipo: 'transferencia', valor, data, descricao: 'Pagamento', conta_id: corrente, conta_destino_id: cartao });
  await compra(60_00, '2026-08-20'); // fatura de setembro (fecha 05/09)
  await compra(40_00, '2026-09-10'); // fatura de outubro (fecha 05/10)
  await compra(25_00, '2026-10-06'); // fatura de novembro (fecha 05/11)

  const resumo = (hoje) => {
    const r = b.faturasDoCartao(cartao, hoje);
    return [r.aberta.mes, r.aberta.restante, r.fechadas.map((f) => [f.mes, f.restante, f.estado]), r.a_pagar];
  };
  igual(resumo('2026-10-13'), ['2026-11', 25_00, [['2026-09', 60_00, 'vencida'], ['2026-10', 40_00, 'fechada']], 300_00],
    'sem pagamentos: o cadastro (200) e as duas faturas fechadas estão a pagar');

  await pagar(230_00, '2026-10-01'); // quita os 200 do cadastro e 30 da fatura de setembro
  igual(resumo('2026-10-13'), ['2026-11', 25_00, [['2026-09', 30_00, 'vencida'], ['2026-10', 40_00, 'fechada']], 70_00],
    'o pagamento começa pela dívida do cadastro');
  await pagar(70_00, '2026-10-12');
  igual(resumo('2026-10-13'), ['2026-11', 25_00, [], 0], 'tudo o que fechou está pago');
  igual(b.fatura(cartao, '2026-10', '2026-10-13').estado, 'paga');

  // Cartão sem as datas, conta bancária e mês inválido não têm fatura.
  const semDatas = await b.salvarConta({ nome: 'Sem datas', tipo: 'cartao', dia_fechamento: 10 });
  await recusa(() => b.fatura(semDatas, '2026-11'), 'fechamento e de vencimento');
  await recusa(() => b.faturasDoCartao(semDatas), 'fechamento e de vencimento');
  await recusa(() => b.fatura(corrente, '2026-11'), 'Só cartões');
  await recusa(() => b.fatura(cartao, '2026-13'), 'Mês inválido');
  await recusa(() => b.fatura(999, '2026-11'), 'não encontrado');
});

teste('exportar CSV', async ({ b, cat, lancar }) => {
  await lancar('despesa', 1234_56, { descricao: '=SOMA(A1)', categoria_id: cat('Lazer') });
  await lancar('receita', 10_00, { descricao: 'Venda; "usada"' });
  const [cabecalho, receita, despesa] = b.csv({ mes: MES }).replace('﻿', '').trim().split('\r\n');
  const dia = HOJE.split('-').reverse().join('/');
  igual(cabecalho, 'Data;Descrição;Tipo;Categoria;Conta;Conta destino;Valor');
  igual(receita, `${dia};"Venda; ""usada""";Receita;;Conta corrente;;10,00`);
  igual(despesa, `${dia};'=SOMA(A1);Despesa;Lazer;Conta corrente;;-1234,56`);
});

teste('os dados continuam lá ao reabrir o banco', async ({ b, lancar }, nome) => {
  await lancar('receita', 77_00, { descricao: 'Persistência' });
  b.fechar();
  const reaberto = await abrirBanco(nome);
  igual(reaberto.lancamentos({ mes: MES }).map((l) => [l.descricao, l.valor]), [['Persistência', 77_00]]);
  igual(reaberto.contas().length, 2, 'as contas iniciais não são recriadas');
  reaberto.fechar();
});

teste('backup: exportar e restaurar em outro aparelho', async ({ b, carteira, cat, lancar }, nome) => {
  await lancar('receita', 900_00, { categoria_id: cat('Salário') });
  await lancar('transferencia', 100_00, { conta_destino_id: carteira });
  const cartao = await b.salvarConta({
    nome: 'Cartão', tipo: 'cartao', banco: 'Banco X', bandeira: 'elo', numero: '9876', limite: 1000_00,
    dia_fechamento: 10, dia_vencimento: 20, conta_pagamento_id: carteira, saldo_inicial: -50_00,
  });
  await lancar('despesa', 80_00, { conta_id: cartao });
  await lancar('despesa', 300_00, { conta_id: cartao, descricao: 'Parcelada', parcelas: 3 });
  await b.definirOrcamento(cat('Lazer'), somarMeses(MES, -2), 300_00);
  await b.definirOrcamento(cat('Lazer'), MES, 350_00);
  await b.definirOrcamento(cat('Lazer'), somarMeses(MES, 3), null);
  const arquivo = JSON.parse(JSON.stringify(b.exportar())); // ida e volta, como no arquivo

  const outro = await abrirBanco(`${nome}-outro`);
  try {
    await outro.salvarConta({ nome: 'Some ao restaurar', tipo: 'poupanca' });
    // Como a tela faz: confere o arquivo para mostrar o resumo e só então restaura.
    await outro.importar(validarBackup(arquivo));
    igual(outro.exportar().lancamentos, b.exportar().lancamentos, 'lançamentos');
    igual(outro.contas(), b.contas(), 'contas, cartões e saldos');
    igual(outro.contas().find((c) => c.tipo === 'cartao').limite, 1000_00, 'limite do cartão');
    igual(outro.exportar().lancamentos.filter((l) => l.parcela_total === 3).map((l) => l.parcela_numero), [1, 2, 3], 'parcelas');
    for (const mes of [-3, -1, 0, 2, 4].map((n) => somarMeses(MES, n))) {
      igual(outro.orcamentos(mes), b.orcamentos(mes), `orçamentos de ${mes}`);
    }
    igual(outro.orcamentos(somarMeses(MES, -1)).find((o) => o.nome === 'Lazer').limite, 300_00, 'limite antigo');
    // Depois de restaurar, novos registros não reaproveitam ids do backup.
    const novo = await outro.salvarLancamento(
      { tipo: 'despesa', valor: 1, data: HOJE, descricao: 'Novo', conta_id: carteira });
    igual(arquivo.lancamentos.some((l) => l.id === novo), false, 'id novo');
  } finally {
    outro.fechar();
    indexedDB.deleteDatabase(`${nome}-outro`);
  }
});

teste('backup da versão 1 (limites sem mês) é aceito', async ({ b, cat }) => {
  const atual = JSON.parse(JSON.stringify(b.exportar()));
  const antigo = {
    ...atual,
    versao: 1,
    contas: atual.contas.map((c) => ({ id: c.id, nome: c.nome, tipo: c.tipo, saldo_inicial: 12_00, arquivada: false })),
    orcamentos: [{ categoria_id: cat('Lazer'), limite: 300_00 }],
  };
  await b.importar(antigo);
  igual(b.contas().map((c) => [c.saldo, c.banco, c.limite]), [[12_00, '', null], [12_00, '', null]], 'contas sem os campos novos');
  const limite = (mes) => b.orcamentos(mes).find((o) => o.nome === 'Lazer').limite;
  igual([limite('2020-01'), limite(MES)], [300_00, 300_00], 'vale para todos os meses, como valia');
});

teste('backup inválido é recusado sem alterar os dados', async ({ b, corrente, cat, lancar }) => {
  await lancar('receita', 10_00);
  await b.definirOrcamento(cat('Lazer'), MES, 100_00);
  const idCartao = await b.salvarConta({ nome: 'Cartão', tipo: 'cartao', conta_pagamento_id: corrente });
  const cartaoDe = (c) => c.contas.find((conta) => conta.id === idCartao);
  const bom = JSON.parse(JSON.stringify(b.exportar()));
  const estragar = (mexer) => {
    const copia = structuredClone(bom);
    mexer(copia);
    return copia;
  };
  const ruins = [
    null, {}, [], 'texto', { ...bom, formato: 'outro-app' }, { ...bom, lancamentos: 'x' },
    estragar((c) => { c.lancamentos[0].conta_id = 999; }),
    estragar((c) => { c.lancamentos[0].valor = -1; }),
    estragar((c) => { c.lancamentos[0].data = '2026-13-01'; }),
    estragar((c) => { c.lancamentos[0].parcela_numero = 2; }), // parcela pela metade
    estragar((c) => { Object.assign(c.lancamentos[0], { parcela_numero: 5, parcela_total: 3, parcela_grupo: 'x' }); }),
    estragar((c) => { Object.assign(c.lancamentos[0], { parcela_numero: 1, parcela_total: 99, parcela_grupo: 'x' }); }),
    estragar((c) => { c.lancamentos.push({ ...c.lancamentos[0] }); }), // id repetido
    estragar((c) => { c.lancamentos[0].tipo = 'transferencia'; c.lancamentos[0].conta_destino_id = corrente; }),
    estragar((c) => { c.contas[0].tipo = 'cofre'; }),
    estragar((c) => { cartaoDe(c).conta_pagamento_id = 999; }),
    estragar((c) => { cartaoDe(c).conta_pagamento_id = idCartao; }), // fatura paga por um cartão
    estragar((c) => { cartaoDe(c).dia_fechamento = 40; }),
    estragar((c) => { cartaoDe(c).numero = '1234 5678 9012 3456'; }), // número inteiro do cartão
    estragar((c) => { cartaoDe(c).limite = -1; }),
    estragar((c) => { c.categorias[0].nome = ''; }),
    estragar((c) => { c.orcamentos.push({ categoria_id: 999, mes: MES, limite: 100 }); }),
    estragar((c) => { c.orcamentos.push({ categoria_id: cat('Saúde'), limite: 100 }); }), // sem mês
    estragar((c) => { c.orcamentos.push({ ...c.orcamentos[0] }); }), // mesma mudança duas vezes
    estragar((c) => { c.orcamentos[0].limite = 0; }),
  ];
  for (const ruim of ruins) await recusa(() => b.importar(ruim), 'backup válido');
  await recusa(() => b.importar({ ...bom, versao: 99 }), 'versão mais nova');
  igual(b.exportar().lancamentos, bom.lancamentos, 'dados intactos');
  // Campos desconhecidos são descartados, não gravados.
  const limpo = validarBackup(estragar((c) => { c.contas[0].intruso = '<script>'; }));
  igual(Object.keys(limpo.contas[0]).sort(), [
    'agencia', 'arquivada', 'banco', 'bandeira', 'conta_pagamento_id', 'dia_fechamento', 'dia_vencimento',
    'id', 'limite', 'nome', 'numero', 'saldo_inicial', 'tipo',
  ], 'campos da conta');
});

teste('somarMeses atravessa a virada do ano', async () => {
  igual([somarMeses('2026-01', -1), somarMeses('2026-12', 1), somarMeses('2026-10', -5), somarMeses('2026-03', 22)],
    ['2025-12', '2027-01', '2026-05', '2028-01']);
});

// ---------------------------------------------------------------- execução

const lista = document.querySelector('#lista');
let falhas = 0;
for (const [nome, corpo] of testes) {
  const banco = `teste-${crypto.randomUUID()}`;
  const item = document.createElement('li');
  let contexto;
  try {
    contexto = await preparar(banco);
    await corpo(contexto, banco);
    item.textContent = `OK · ${nome}`;
  } catch (erro) {
    falhas += 1;
    item.className = 'falhou';
    item.textContent = `FALHOU · ${nome}`;
    const detalhe = document.createElement('pre');
    detalhe.textContent = erro.stack ?? String(erro);
    item.append(detalhe);
  } finally {
    contexto?.b.fechar();
    indexedDB.deleteDatabase(banco);
  }
  lista.append(item);
}

const resultado = document.querySelector('#resultado');
resultado.textContent = falhas
  ? `${falhas} de ${testes.length} testes falharam.`
  : `Todos os ${testes.length} testes passaram.`;
resultado.className = falhas ? 'falhou' : '';
resultado.dataset.fim = falhas ? 'falhou' : 'ok';
