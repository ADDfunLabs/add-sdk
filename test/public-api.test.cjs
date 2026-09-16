const test=require('node:test'),assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url');
const {Interface,MaxUint256,ZeroAddress}=require('ethers');
const sdk=require('../dist/cjs/index.js');
test('ESM and CommonJS expose the same public client and bigint utilities',async()=>{
 const esm=await import(pathToFileURL(require('node:path').resolve(__dirname,'../dist/esm/index.js')).href);
 assert.deepEqual(Object.keys(esm).sort(),Object.keys(sdk).sort());
 assert.equal(esm.remainingBuyBudget(100n),103n);assert.equal(sdk.minimumOutput(1000n),995n);
});
test('3% remaining budget never rounds up or accepts a higher percentage',()=>{
 for(const n of [1n,99n,100n,12345678901234567890123456n]){
  const b=sdk.remainingBuyBudget(n);assert.ok(b*100n<=n*103n);assert.ok(b>=n);
 }
 for(const b of [301,3.5,-1,NaN])assert.throws(()=>sdk.remainingBuyBudget(100n,b));
 assert.throws(()=>sdk.remainingBuyBudget(MaxUint256));assert.throws(()=>sdk.remainingBuyBudget(1));
});
test('slippage validates integer BPS and never produces a zero minimum',()=>{
 assert.equal(sdk.minimumOutput(1n,1000),1n);assert.equal(sdk.minimumOutput(1000n,0),1000n);
 for(const p of [-1,0.5,1001,NaN])assert.throws(()=>sdk.minimumOutput(100n,p));
 assert.throws(()=>sdk.minimumOutput(0n));assert.throws(()=>sdk.minimumOutput(-1n));
});
test('links require a nonzero hexadecimal token, rejecting names and injections',()=>{
 const ca='0x0262ab46b8b0a6deb63092092419192a69401111';
 assert.ok(sdk.tokenPageUrl(ca).toLowerCase().endsWith(ca));
 assert.ok(sdk.pancakeSwapUrl(ca).includes('chain=bsc'));
 for(const input of [ZeroAddress,'example.eth','javascript:alert(1)','https://x.test'])assert.throws(()=>sdk.tokenPageUrl(input));
});
test('known deployment pins and generated ABI are frozen/public and contain no owner transaction helpers',()=>{
 assert.equal(sdk.BSC_PORTALS.length,3);assert.ok(Object.isFrozen(sdk.BSC_PORTALS));assert.ok(Object.isFrozen(sdk.BSC_PORTALS[0]));
 const i=new Interface(sdk.PORTAL_ABI);assert.ok(i.getFunction('swapExactInput'));assert.equal(i.getFunction('emergencyWithdrawBNB'),null);
 assert.equal(i.getFunction('beginRecovery'),null);assert.equal(i.getFunction('setDefaultTargetETH'),null);
});
test('decoder ignores foreign contracts and malformed logs, and preserves quote-asset event units',()=>{
 const c=new sdk.AddClient({}),i=new Interface(sdk.PORTAL_ABI),p=sdk.PRIMARY_PORTAL;
 const e=i.encodeEventLog(i.getEvent('QuoteSettlement'),[p,ZeroAddress,true,123n,456n]);
 const log={address:p,...e,blockNumber:123,blockHash:'0x'+'11'.repeat(32),transactionHash:'0x'+'22'.repeat(32),index:2,removed:false};
 assert.equal(c.decodePortalLog(log).args.quoteAmount,123n);assert.equal(c.decodePortalLog(log).args.bnbPrincipal,456n);
 assert.equal(c.decodePortalLog({...log,address:ZeroAddress}),null);assert.equal(c.decodePortalLog({...log,data:'0x01'}),null);
});
test('wrong chain fails before contract reads; malformed block requests fail without fallback',async()=>{
 const c=new sdk.AddClient({getNetwork:async()=>({chainId:1n})});
 await assert.rejects(c.readToken(sdk.PRIMARY_PORTAL),{code:'WRONG_CHAIN'});
 const b=new sdk.AddClient({getNetwork:async()=>({chainId:56n}),getBlock:async()=>null});
 await assert.rejects(b.readToken(sdk.PRIMARY_PORTAL),{code:'BLOCK_UNAVAILABLE'});
 await assert.rejects(b.readToken(sdk.PRIMARY_PORTAL,{blockTag:'pending'}),{code:'INVALID_BLOCK'});
});
test('log range is bounded before issuing a potentially expensive RPC query',async()=>{
 const c=new sdk.AddClient({});await assert.rejects(c.getPortalEvents(sdk.PRIMARY_PORTAL,0,2000),{code:'RANGE_TOO_LARGE'});
 await assert.rejects(c.getPortalEvents(sdk.PRIMARY_PORTAL,10,9),{code:'INVALID_PARAMETER'});
});
