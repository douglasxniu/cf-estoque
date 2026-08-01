// Presets salvos do editor de etiquetas (nome -> design completo) — arquivo local em disco,
// não faz parte do deploy do Worker nem do banco D1. Compartilhado por todo mundo que acessa
// este print-agent na rede (ou via túnel), já que fica no servidor, não no navegador de cada um.
'use strict';
const fs = require('fs');
const path = require('path');
const ARQUIVO = path.join(__dirname, 'modelos.json');

function carregarTodos() {
  try { return JSON.parse(fs.readFileSync(ARQUIVO, 'utf8')); } catch (e) { return {}; }
}
function salvarTodos(modelos) {
  fs.writeFileSync(ARQUIVO, JSON.stringify(modelos, null, 2));
}

function listar() {
  const modelos = carregarTodos();
  return Object.entries(modelos)
    .map(([nome, m]) => ({ nome, largura: m.largura, altura: m.altura, atualizadoEm: m.atualizadoEm }))
    .sort((a, b) => a.nome.localeCompare(b.nome, 'pt'));
}
function obter(nome) {
  return carregarTodos()[nome] || null;
}
function salvar(nome, design) {
  if (!nome || !String(nome).trim()) throw new Error('Nome do modelo é obrigatório.');
  if (!(design.largura > 0) || !(design.altura > 0)) throw new Error('Tamanho da etiqueta inválido.');
  const modelos = carregarTodos();
  const agora = new Date().toISOString();
  modelos[nome] = {
    largura: design.largura, altura: design.altura, elementos: design.elementos || [],
    criadoEm: (modelos[nome] && modelos[nome].criadoEm) || agora, atualizadoEm: agora
  };
  salvarTodos(modelos);
  return modelos[nome];
}
function excluir(nome) {
  const modelos = carregarTodos();
  delete modelos[nome];
  salvarTodos(modelos);
}

module.exports = { listar, obter, salvar, excluir };
