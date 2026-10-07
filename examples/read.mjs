// Read-only new V1 example. Set ADD_CHAIN_ID=56 or 1, ADD_RPC_URL and ADD_TOKEN.
import { JsonRpcProvider, formatUnits, parseEther } from 'ethers';
import { AddV1Client } from '@add-fun/sdk';
const chainId=Number(process.env.ADD_CHAIN_ID);
if (![1,56].includes(chainId)||!process.env.ADD_RPC_URL||!process.env.ADD_TOKEN) throw Error('Set ADD_CHAIN_ID (1 or 56), ADD_RPC_URL and ADD_TOKEN.');
const provider=new JsonRpcProvider(process.env.ADD_RPC_URL);
try {
  const add=new AddV1Client(provider,{chainId}),state=await add.readToken(process.env.ADD_TOKEN);
  console.log(state.name,state.phase,state.token,'reviewed:',state.reviewed);
  console.log('Quote target:',formatUnits(state.quoteTarget,state.quoteDecimals),'Reserve:',formatUnits(state.reserve,state.quoteDecimals));
  if(state.phase==='active'&&state.reviewed) {
    const quote=await add.quoteBuy(state.token,parseEther('0.01'));
    console.log(JSON.stringify(quote,(_,v)=>typeof v==='bigint'?v.toString():v,2));
  }
} finally { provider.destroy(); }
