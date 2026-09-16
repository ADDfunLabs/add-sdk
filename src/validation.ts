import { getAddress, MaxUint256, ZeroAddress } from 'ethers';
export class AddSdkError extends Error {
  constructor(public readonly code: string, message: string) { super(message); this.name='AddSdkError'; }
}
export function ensure(ok: unknown, code: string, message: string): asserts ok {
  if (!ok) throw new AddSdkError(code, message);
}
export function address(input: string, allowZero=false): string {
  let result: string;
  try { result=getAddress(input); } catch { throw new AddSdkError('INVALID_ADDRESS','Use a valid hexadecimal address, not an ENS name.'); }
  ensure(allowZero || result!==ZeroAddress,'INVALID_ADDRESS','Zero address is not allowed here.'); return result;
}
export function uint(value: bigint, positive=false): bigint {
  ensure(typeof value==='bigint' && value>=(positive?1n:0n) && value<=MaxUint256,'INVALID_AMOUNT','Use a bigint within uint256 bounds.'); return value;
}
export function whole(value: number, min: number, max: number): number {
  ensure(Number.isSafeInteger(value) && value>=min && value<=max,'INVALID_PARAMETER',`Expected an integer from ${min} to ${max}.`); return value;
}
export const same=(a:string,b:string)=>a.toLowerCase()===b.toLowerCase();
export function minimumOutput(output: bigint, slippageBps=50): bigint {
  uint(output,true); whole(slippageBps,0,1000);
  const result=output*BigInt(10000-slippageBps)/10000n;
  return result>0n?result:1n;
}
export function remainingBuyBudget(quotedPayment: bigint, bufferBps=300): bigint {
  uint(quotedPayment,true); whole(bufferBps,0,300);
  return uint(quotedPayment*BigInt(10000+bufferBps)/10000n,true);
}
export function tokenPageUrl(token: string): string { return `https://add.fun/token-detail/${address(token)}`; }
export function pancakeSwapUrl(token: string): string { return `https://pancakeswap.finance/swap?chain=bsc&inputCurrency=BNB&outputCurrency=${address(token)}`; }
