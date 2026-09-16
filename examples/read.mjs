// Read-only example. Set BSC_RPC_URL to your endpoint and ADD_TOKEN to a launched CA.
import { JsonRpcProvider, formatUnits, parseEther } from 'ethers';
import { AddClient, tokenPageUrl } from '@add-fun/sdk';
if (!process.env.BSC_RPC_URL || !process.env.ADD_TOKEN) throw Error('Set BSC_RPC_URL and ADD_TOKEN.');
const provider=new JsonRpcProvider(process.env.BSC_RPC_URL);
try {
  const add=new AddClient(provider),state=await add.readToken(process.env.ADD_TOKEN);
  console.log(state.name,state.phase,tokenPageUrl(state.token));
  console.log('Target:',formatUnits(state.target,state.quoteDecimals),'Reserve:',formatUnits(state.reserve,state.quoteDecimals));
  if(state.phase==='launch') {
    const quote=await add.quoteBuy(state.token,parseEther('0.01'));
    console.log(JSON.stringify(quote,(_,v)=>typeof v==='bigint'?v.toString():v,2));
  }
} finally { provider.destroy(); }
