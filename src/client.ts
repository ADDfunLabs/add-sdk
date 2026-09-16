import { Contract, Interface, keccak256, ZeroAddress, type Provider, type Log } from 'ethers';
import { BSC_PORTALS, PORTAL_ABI, TOKEN_ABI, PRIMARY_PORTAL } from './generated.js';
import { address, ensure, same, uint, whole, minimumOutput, remainingBuyBudget } from './validation.js';
import type { TrustedPortal, ReadBlock, BlockReference, TokenSnapshot, TradeQuote, UnsignedTransaction, SwapOptions, PortalEvent } from './types.js';

const portalInterface=new Interface(PORTAL_ABI), tokenInterface=new Interface(TOKEN_ABI);
const routerABI=['function WETH() view returns(address)','function getAmountsIn(uint256,address[]) view returns(uint256[])'];
const MAX_QUOTE_AGE=120;

/** BSC-only integration client. Never owns a signer, signs, broadcasts or requests private keys. */
export class AddClient {
  readonly provider: Provider;
  readonly portals: readonly TrustedPortal[];
  private readonly issuedQuotes=new WeakSet<object>();

  /** Override trust pins only after separately reviewing the specified Portal bytecode. */
  constructor(provider: Provider, options: { portals?: readonly TrustedPortal[] }={}) {
    this.provider=provider;
    this.portals=Object.freeze((options.portals??BSC_PORTALS).map(p=>{
      ensure(/^0x[0-9a-fA-F]{64}$/.test(p.codeHash),'INVALID_DEPLOYMENT','A runtime code hash is required.');
      whole(p.startBlock,0,Number.MAX_SAFE_INTEGER); whole(p.deploymentVersion,12,13);
      return Object.freeze({...p,address:address(p.address),codeHash:p.codeHash.toLowerCase()});
    }));
    ensure(new Set(this.portals.map(p=>p.address)).size===this.portals.length,'INVALID_DEPLOYMENT','Duplicate Portal entries.');
  }
  private entry(portal: string): TrustedPortal {
    const result=this.portals.find(p=>same(p.address,portal));
    ensure(result,'UNTRUSTED_PORTAL','Token is not bound to a supported, pinned Portal.'); return result;
  }
  private async block(tag: ReadBlock='latest'): Promise<BlockReference> {
    ensure((await this.provider.getNetwork()).chainId===56n,'WRONG_CHAIN','ADD SDK supports BSC mainnet (56) only.');
    if(typeof tag==='number')whole(tag,0,Number.MAX_SAFE_INTEGER);
    else ensure(tag==='latest'||tag==='finalized','INVALID_BLOCK','Use a nonnegative block number, latest or finalized.');
    const b=await this.provider.getBlock(tag);
    ensure(b?.hash,'BLOCK_UNAVAILABLE','The requested block is unavailable.');
    return {blockNumber:b.number,blockHash:b.hash,timestamp:b.timestamp};
  }
  private async stable(b: BlockReference): Promise<void> {
    const now=await this.provider.getBlock(b.blockNumber);
    ensure(now?.hash===b.blockHash,'BLOCK_CHANGED','Block changed during the read. Discard this result and retry.');
  }
  private async portal(portal: string, b: BlockReference): Promise<Contract> {
    const entry=this.entry(address(portal));
    ensure(b.blockNumber>=entry.startBlock,'BEFORE_DEPLOYMENT','Portal was not deployed at the requested block.');
    const code=await this.provider.getCode(entry.address,b.blockNumber);
    ensure(code!=='0x'&&keccak256(code)===entry.codeHash,'CODE_MISMATCH','Portal runtime code does not match the trusted deployment.');
    const contract=new Contract(entry.address,PORTAL_ABI,this.provider);
    const version=await contract.getFunction('DEPLOYMENT_VERSION')({blockTag:b.blockNumber});
    ensure(version===BigInt(entry.deploymentVersion),'VERSION_MISMATCH','Unexpected Portal deployment version.');
    return contract;
  }
  private async tokenAt(input: string, b: BlockReference): Promise<TokenSnapshot> {
    const token=address(input), c=new Contract(token,TOKEN_ABI,this.provider), at={blockTag:b.blockNumber};
    const bound=address(await c.getFunction('factory')(at)), p=await this.portal(bound,b);
    const registered=await p.getFunction('isTokenSale')(token,at);
    ensure(registered,'UNREGISTERED_TOKEN','This token is not registered by its bound Portal.');
    const [config,reserve,sold,saleAmount,recovery,recipient,name,symbol,decimals,quoteDecimals,phase,ended,liquidity]=await Promise.all([
      p.getFunction('saleConfiguration')(token,at),p.getFunction('reserve')(token,at),p.getFunction('totalSold')(token,at),
      p.getFunction('SALE_AMOUNT')(at),p.getFunction('recoveryDestination')(at),p.getFunction('feeRecipient')(at),
      c.getFunction('name')(at),c.getFunction('symbol')(at),c.getFunction('decimals')(at),c.getFunction('quoteDecimals')(at),
      c.getFunction('phase')(at),c.getFunction('saleEnded')(at),c.getFunction('liquidityAdded')(at),
    ]);
    // Reserve denomination, route and target come from the Portal's fixed ledger, not mutable token metadata.
    const target=uint(config[3],true), totalSold=uint(sold), supply=uint(saleAmount,true), balance=uint(reserve);
    ensure(totalSold<=supply&&phase>=0n&&phase<=2n,'INVALID_STATE','Invalid supply or phase.');
    ensure((phase===2n)===Boolean(liquidity)&&Boolean(ended)===(phase!==0n),'INVALID_STATE','Inconsistent graduation state.');
    const qd=whole(Number(quoteDecimals),0,36), td=whole(Number(decimals),0,36);
    const asset=address(config[0],true);
    ensure(asset!==ZeroAddress||qd===18,'INVALID_STATE','Native BNB must use 18 decimals.');
    return Object.freeze({...b,token,portal:bound,name:String(name),symbol:String(symbol),decimals:td,
      phase:phase===2n?'graduated':phase===1n?'migrating':'launch',quoteAsset:asset,quoteDecimals:qd,
      router:address(config[1]),pair:address(config[2]),target,reserve:balance,saleAmount:supply,totalSold,
      remaining:supply-totalSold,progressBps:phase===0n?balance*10000n/target:null,
      feeRecipient:address(recipient),recoveryDestination:address(recovery,true),deploymentVersion:this.entry(bound).deploymentVersion});
  }
  private tradable(s: TokenSnapshot): void {
    ensure(s.recoveryDestination===ZeroAddress,'PORTAL_IN_RECOVERY','This Portal has permanently stopped normal trading.');
    ensure(s.phase==='launch','EXTERNAL_TRADING_ONLY','This SDK trades the launch market only. Use PancakeSwap after graduation.');
  }
  async readToken(token: string, options: {blockTag?: ReadBlock}={}): Promise<TokenSnapshot> {
    const b=await this.block(options.blockTag),s=await this.tokenAt(token,b); await this.stable(b); return s;
  }
  /** Reads the current default, including non-native asset conversion/whole-token rounding. Never assumes 1 BNB forever. */
  async getLaunchTarget(quoteAsset=ZeroAddress, portal=PRIMARY_PORTAL, options: {blockTag?: ReadBlock}={}) {
    const asset=address(quoteAsset,true),b=await this.block(options.blockTag),p=await this.portal(portal,b);
    const [target,decimals]=await p.getFunction('quoteGraduationTarget')(asset,{blockTag:b.blockNumber});
    await this.stable(b);
    return Object.freeze({...b,portal:address(portal),quoteAsset:asset,target:uint(target,true),decimals:whole(Number(decimals),0,36)});
  }
  private issued(q: TradeQuote): TradeQuote { Object.freeze(q); this.issuedQuotes.add(q); return q; }
  private async buyAt(s: TokenSnapshot, payment: bigint, kind: 'buy'|'remaining', quotedPayment?: bigint): Promise<TradeQuote> {
    this.tradable(s); uint(payment,true);
    const p=new Contract(s.portal,PORTAL_ABI,this.provider);
    const [output,principal,fee,refund]=await p.getFunction('quoteBuy')(s.token,payment,{blockTag:s.blockNumber});
    uint(output,true);uint(principal);uint(fee);uint(refund);
    ensure(output<=s.remaining&&principal+fee+refund===payment,'INVALID_QUOTE','Portal returned an inconsistent buy quote.');
    return this.issued({kind,token:s.token,portal:s.portal,inputAmount:payment,outputAmount:output,principalBNB:principal,feeBNB:fee,
      refundBNB:refund,quotedPaymentBNB:quotedPayment??payment-refund,blockNumber:s.blockNumber,blockHash:s.blockHash,timestamp:s.timestamp});
  }
  async quoteBuy(token: string, paymentBNB: bigint, options: {blockTag?: ReadBlock}={}): Promise<TradeQuote> {
    uint(paymentBNB,true);const b=await this.block(options.blockTag),s=await this.tokenAt(token,b),q=await this.buyAt(s,paymentBNB,'buy');
    await this.stable(b);return q;
  }
  async quoteSell(token: string, tokenAmount: bigint, options: {blockTag?: ReadBlock}={}): Promise<TradeQuote> {
    uint(tokenAmount,true);const b=await this.block(options.blockTag),s=await this.tokenAt(token,b);this.tradable(s);
    ensure(tokenAmount<=s.totalSold,'INVALID_AMOUNT','Sell amount exceeds net sold supply.');
    const p=new Contract(s.portal,PORTAL_ABI,this.provider);
    const [gross,fee,net]=await p.getFunction('quoteSell')(s.token,tokenAmount,{blockTag:b.blockNumber});
    uint(gross,true);uint(fee);uint(net,true);ensure(gross===fee+net,'INVALID_QUOTE','Inconsistent sell quote.');await this.stable(b);
    return this.issued({...b,kind:'sell',token:s.token,portal:s.portal,inputAmount:tokenAmount,outputAmount:net,principalBNB:gross,
      feeBNB:fee,refundBNB:0n,quotedPaymentBNB:0n});
  }
  /** Buy the whole remaining launch supply. Does not silently truncate to a wallet balance. */
  async quoteRemainingBuy(token: string, options: {blockTag?: ReadBlock;bufferBps?:number}={}): Promise<TradeQuote> {
    const buffer=whole(options.bufferBps??300,0,300),b=await this.block(options.blockTag),s=await this.tokenAt(token,b);this.tradable(s);
    uint(s.remaining,true);
    const principal=(s.remaining*s.target+s.saleAmount-1n)/s.saleAmount;
    let bnbPrincipal=principal;
    if(s.quoteAsset!==ZeroAddress){
      const r=new Contract(s.router,routerABI,this.provider),at={blockTag:b.blockNumber};
      const wrapped=await r.getFunction('WETH')(at);
      const amounts=await r.getFunction('getAmountsIn')(principal,[wrapped,s.quoteAsset],at);
      ensure(amounts.length===2&&amounts[1]===principal,'INVALID_QUOTE','Invalid quote-asset conversion.');bnbPrincipal=uint(amounts[0],true);
    }
    const fee=bnbPrincipal/99n,quoted=uint(bnbPrincipal+fee,true),payment=remainingBuyBudget(quoted,buffer);
    const q=await this.buyAt(s,payment,'remaining',quoted);
    ensure(q.outputAmount===s.remaining&&q.principalBNB===bnbPrincipal&&q.feeBNB===fee&&q.refundBNB===payment-quoted,
      'QUOTE_CHANGED','Remaining-supply quote does not match Portal settlement.');
    await this.stable(b);return q;
  }
  /** Quotes must come from this client. Builds calldata; does not send it or spend gas. */
  async buildSwap(quote: TradeQuote, account: string, options: SwapOptions): Promise<UnsignedTransaction> {
    ensure(this.issuedQuotes.has(quote),'INVALID_QUOTE','Use an unmodified quote returned by this client.');
    const from=address(account),slippage=whole(options.slippageBps??50,0,1000);uint(options.deadline,true);
    const b=await this.block();
    ensure(b.timestamp>=quote.timestamp&&b.timestamp-quote.timestamp<=MAX_QUOTE_AGE,'STALE_QUOTE','Quote is older than 120 seconds. Request a new quote.');
    ensure(options.deadline>BigInt(b.timestamp)&&options.deadline<=BigInt(b.timestamp+900),'INVALID_DEADLINE','Deadline must be in the next 15 minutes.');
    await this.stable(quote);
    const s=await this.tokenAt(quote.token,b);this.tradable(s);
    ensure(same(s.portal,quote.portal),'PORTAL_CHANGED','The token Portal changed.');
    if(quote.kind==='remaining')ensure(s.remaining===quote.outputAmount,'QUOTE_CHANGED','Remaining supply changed. Request a new MAX quote.');
    await this.stable(b);
    const sell=quote.kind==='sell',minimum=quote.kind==='remaining'?quote.outputAmount:minimumOutput(quote.outputAmount,slippage);
    return {chainId:56,from,to:s.portal,value:sell?0n:quote.inputAmount,
      data:portalInterface.encodeFunctionData('swapExactInput',[[sell?s.token:ZeroAddress,sell?ZeroAddress:s.token,quote.inputAmount,minimum,options.deadline]])};
  }
  /** Exact-amount approval to the token's own pinned Portal. No unlimited approval. */
  async buildApproval(token: string, account: string, amount: bigint): Promise<UnsignedTransaction> {
    uint(amount,true);const s=await this.readToken(token);this.tradable(s);
    return {chainId:56,from:address(account),to:s.token,value:0n,data:tokenInterface.encodeFunctionData('approve',[s.portal,amount])};
  }
  async readAllowance(token: string, account: string) {
    const owner=address(account),s=await this.readToken(token),c=new Contract(s.token,TOKEN_ABI,this.provider);
    const [allowance,balance]=await Promise.all([c.getFunction('allowance')(owner,s.portal,{blockTag:s.blockNumber}),c.getFunction('balanceOf')(owner,{blockTag:s.blockNumber})]);
    await this.stable(s);return Object.freeze({token:s.token,portal:s.portal,account:owner,allowance:uint(allowance),balance:uint(balance),blockNumber:s.blockNumber});
  }
  /** eth_call only. For sells, simulate again after any required approval has confirmed. */
  async simulate(transaction: UnsignedTransaction): Promise<string> {
    await this.block();ensure(transaction.chainId===56,'WRONG_CHAIN','Transaction chain must be 56.');
    address(transaction.from);address(transaction.to);uint(transaction.value);
    return this.provider.call(transaction);
  }
  decodePortalLog(log: Pick<Log,'address'|'data'|'topics'|'blockNumber'|'blockHash'|'transactionHash'|'index'|'removed'>): PortalEvent | null {
    if(!this.portals.some(p=>same(p.address,log.address)))return null;
    let parsed;try{parsed=portalInterface.parseLog(log);}catch{return null;}if(!parsed)return null;
    const args:Record<string,unknown>={};parsed.fragment.inputs.forEach((input,i)=>{args[input.name||String(i)]=parsed.args[i];});
    return Object.freeze({name:parsed.name,portal:address(log.address),args:Object.freeze(args),blockNumber:log.blockNumber,blockHash:log.blockHash,
      transactionHash:log.transactionHash,logIndex:log.index,removed:log.removed});
  }
  /** One explicit, bounded range per call. Indexers persist cursors and handle confirmations/reorgs themselves. */
  async getPortalEvents(portal: string, fromBlock: number, toBlock: number): Promise<readonly PortalEvent[]> {
    whole(fromBlock,0,Number.MAX_SAFE_INTEGER);whole(toBlock,fromBlock,Number.MAX_SAFE_INTEGER);
    ensure(toBlock-fromBlock<2000,'RANGE_TOO_LARGE','Request at most 2,000 blocks per call; RPC providers may require less.');
    const b=await this.block(toBlock);await this.portal(portal,b);
    ensure(fromBlock>=this.entry(portal).startBlock,'BEFORE_DEPLOYMENT','Start from the Portal deployment block.');
    const logs=await this.provider.getLogs({address:address(portal),fromBlock,toBlock});await this.stable(b);
    return Object.freeze(logs.map(log=>this.decodePortalLog(log)).filter((e):e is PortalEvent=>e!==null));
  }
}
