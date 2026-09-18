'use strict';

/**
 * Cria um comando stub que apenas informa que ainda não foi implementado.
 * Usado por `update`, `status` e `uninstall` até que cada um ganhe sua
 * própria issue de implementação.
 */
function makeStub(name) {
  return function stub() {
    console.info(`vetor ${name}: ainda não implementado.`);
  };
}

module.exports = { makeStub };
