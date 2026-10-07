// One read-only range. Production indexers persist their own finalized cursor and handle reorgs.
import { JsonRpcProvider } from 'ethers';
import { AddV1Client } from '@add-fun/sdk';
const chainId=Number(process.env.ADD_CHAIN_ID);
if(![1,56].includes(chainId)||!process.env.ADD_RPC_URL)throw Error('Set ADD_CHAIN_ID (1 or 56) and ADD_RPC_URL.');
const provider=new JsonRpcProvider(process.env.ADD_RPC_URL);
try {
  const add=new AddV1Client(provider,{chainId}),block=await provider.getBlock('finalized');
  if(!block)throw Error('Finalized block unavailable.');
  const start=add.deployment.startBlock;
  const events=await add.getPortalEvents(Math.max(start,block.number-99),block.number);
  console.log(JSON.stringify(events,(_,v)=>typeof v==='bigint'?v.toString():v,2));
} finally { provider.destroy(); }
