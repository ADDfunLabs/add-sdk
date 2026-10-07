'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const {Interface, ZeroAddress} = require('ethers');
const sdk = require('../dist/cjs/index.js');

const code = error => error && typeof error.code === 'string';
const chain = id => sdk.V1_DEPLOYMENTS.find(d => d.chainId === id);
const clone = value => JSON.parse(JSON.stringify(value));
function frozen(value) {
  if (!value || typeof value !== 'object') return;
  assert.ok(Object.isFrozen(value), 'Every nested public trust pin must be immutable');
  for (const child of Object.values(value)) frozen(child);
}

test('new V1 public API is distinct from legacy and identical in ESM/CommonJS', async () => {
  const esm = await import(pathToFileURL(path.resolve(__dirname, '../dist/esm/index.js')).href);
  assert.deepEqual(Object.keys(esm).sort(), Object.keys(sdk).sort());
  for (const name of ['AddV1Client', 'AddClient', 'V1_DEPLOYMENTS', 'V1_PORTAL_ABIS',
    'V1_FACTORY_ABIS', 'V1_TAX_FACTORY_ABIS', 'V1_STAKING_TAX_FACTORY_ABIS',
    'V1_DIVIDEND_ABI', 'V1_STAKING_POOL_ABI', 'V1_STAKING_FACTORY_ABI']) assert.ok(sdk[name], name);
  assert.notEqual(sdk.AddV1Client, sdk.AddClient);
  assert.equal(new Interface(sdk.V1_PORTAL_ABI).getFunction('swapExactInput'), null);
  assert.ok(new Interface(sdk.PORTAL_ABI).getFunction('swapExactInput'));
});

test('only BSC and Ethereum reviewed V1 / staking V2 deployments are published', () => {
  assert.deepEqual(sdk.V1_DEPLOYMENTS.map(d => d.chainId).sort((a, b) => a - b), [1, 56]);
  frozen(sdk.V1_DEPLOYMENTS); frozen(sdk.V1_PORTAL_ABIS);
  assert.notEqual(chain(1).portal.toLowerCase(), chain(56).portal.toLowerCase());
  for (const d of sdk.V1_DEPLOYMENTS) {
    assert.ok(d.startBlock > 0);
    assert.ok(/^0x[0-9a-f]{64}$/i.test(d.portalHash));
    assert.deepEqual(d.mechanisms.map(m => m.kind).sort(), ['staking-tax', 'standard', 'tax']);
    assert.equal(new Set(d.mechanisms.map(m => m.factory.toLowerCase())).size, 3);
    assert.deepEqual(d.staking.map(s => s.kind).sort(), ['standalone', 'tax']);
    for (const s of d.staking) assert.equal(s.version, 2);
    const linked = d.mechanisms.find(m => m.kind === 'staking-tax');
    assert.equal(d.staking.find(s => s.kind === 'tax').factory.toLowerCase(), linked.factory.toLowerCase());
    for (const value of [d.portal, d.router, d.dexFactory, d.wrappedNative]) assert.notEqual(value, ZeroAddress);
  }
});

test('chain ABIs preserve each real native target name and matching shared transaction selectors', () => {
  const eth = new Interface(sdk.V1_PORTAL_ABIS[1]), bsc = new Interface(sdk.V1_PORTAL_ABIS[56]);
  assert.ok(eth.getFunction('DEFAULT_TARGET_ETH')); assert.equal(eth.getFunction('DEFAULT_TARGET_BNB'), null);
  assert.ok(bsc.getFunction('DEFAULT_TARGET_BNB')); assert.equal(bsc.getFunction('DEFAULT_TARGET_ETH'), null);
  for (const method of ['buy', 'sell', 'refund', 'getPool', 'assertPoolBacking', 'quoteBuy', 'quoteSell', 'quoteRefund']) {
    assert.equal(eth.getFunction(method).selector, bsc.getFunction(method).selector);
  }
  const pool = new Interface(sdk.V1_STAKING_POOL_ABI), dividend = new Interface(sdk.V1_DIVIDEND_ABI);
  for (const method of ['owner', 'upgradeTo', 'sweep', 'emergencyWithdraw', 'setFeeRecipient']) assert.equal(pool.getFunction(method), null);
  assert.equal(dividend.getFunction('claimFor').inputs.length, 1, 'Gas payer cannot add a reward receiver');
  assert.equal(dividend.getFunction('claim').inputs[0].type, 'bool');
});

test('V1 requires explicit supported chain and matching immutable deployment override', () => {
  for (const id of [31337, 97, 0, '56', undefined]) assert.throws(() => new sdk.AddV1Client({}, {chainId: id}), code);
  assert.throws(() => new sdk.AddV1Client({}, {chainId: 1, deployment: chain(56)}), {code: 'INVALID_DEPLOYMENT'});
  const original = clone(chain(56)), client = new sdk.AddV1Client({}, {chainId: 56, deployment: original});
  original.portal = ZeroAddress; original.mechanisms[0].factory = ZeroAddress;
  assert.notEqual(client.deployment.portal, ZeroAddress); assert.notEqual(client.deployment.mechanisms[0].factory, ZeroAddress);
  frozen(client.deployment);
  for (const patch of [
    d => {d.portalHash = '0x1234';},
    d => {d.mechanisms.push({...d.mechanisms[0]});},
    d => {d.staking.push({...d.staking[0]});},
    d => {d.staking[0].version = 1;},
    d => {d.mechanisms[1].dividendHash = undefined;},
  ]) {
    const d = clone(chain(56)); patch(d); assert.throws(() => new sdk.AddV1Client({}, {chainId: 56, deployment: d}), code);
  }
});

test('wrong provider chain rejects before block, contract, signer or broadcast work', async () => {
  let prohibited = 0;
  const provider = {getNetwork: async () => ({chainId: 1n}),
    getBlock: async () => {prohibited++; throw Error('Unexpected block read');},
    call: async () => {prohibited++; throw Error('Unexpected call');},
    getSigner: () => {prohibited++; throw Error('Unexpected signer');},
    broadcastTransaction: () => {prohibited++; throw Error('Unexpected broadcast');}};
  const c = new sdk.AddV1Client(provider, {chainId: 56});
  await assert.rejects(c.readToken(chain(56).portal), {code: 'WRONG_CHAIN'});
  await assert.rejects(c.readStakingPool(chain(56).staking[0].factory), {code: 'WRONG_CHAIN'});
  await assert.rejects(c.readCreationDomain('variable-v1'), {code: 'WRONG_CHAIN'});
  assert.equal(prohibited, 0);
});

test('event decoding keeps real per-chain contract identity and original asset amounts', () => {
  for (const id of [1, 56]) {
    const c = new sdk.AddV1Client({}, {chainId: id}), abi = new Interface(sdk.V1_PORTAL_ABIS[id]);
    const encoded = abi.encodeEventLog(abi.getEvent('Buy'), [chain(id).portal, chain(id).feeRecipient,
      1000n, 12345n, 222n, 990n, 10n, 0n]);
    const log = {...encoded, address: chain(id).portal, blockNumber: chain(id).startBlock + 1,
      blockHash: '0x' + '12'.repeat(32), transactionHash: '0x' + '34'.repeat(32), index: 2, removed: false};
    const decoded = c.decodePortalLog(log);
    assert.equal(decoded.chainId, id); assert.equal(decoded.args.quotePrincipal, 222n);
    assert.equal(decoded.args.nativePrincipal, 990n);
    assert.equal(c.decodePortalLog({...log, address: chain(id === 1 ? 56 : 1).portal}), null);
    assert.equal(c.decodePortalLog({...log, data: '0x01'}), null);
  }
});

test('V1 client public surface contains reads/builders/simulation and no signing or send helpers', () => {
  const methods = Object.getOwnPropertyNames(sdk.AddV1Client.prototype);
  for (const name of ['buildTrade', 'buildRefund', 'buildApproval', 'buildStake', 'buildWithdraw',
    'buildDividendClaim', 'buildStakingClaim', 'buildCreateToken', 'buildCreateStakingPool', 'buildCreateCyclePool', 'simulate']) assert.ok(methods.includes(name), name);
  for (const name of ['getSigner', 'sendTransaction', 'broadcastTransaction', 'signTransaction', 'signMessage', 'deploy']) assert.ok(!methods.includes(name), name);
});
