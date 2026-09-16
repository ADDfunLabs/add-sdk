// One read-only range. Production indexers persist their own finalized cursor and handle reorgs.
import { JsonRpcProvider } from 'ethers';
import { AddClient, PRIMARY_PORTAL, BSC_PORTALS } from '@add-fun/sdk';
if(!process.env.BSC_RPC_URL)throw Error('Set BSC_RPC_URL.');
const provider=new JsonRpcProvider(process.env.BSC_RPC_URL);
try {
  const add=new AddClient(provider),block=await provider.getBlock('finalized');
  if(!block)throw Error('Finalized block unavailable.');
  const start=BSC_PORTALS.find(p=>p.address.toLowerCase()===PRIMARY_PORTAL.toLowerCase()).startBlock;
  const events=await add.getPortalEvents(PRIMARY_PORTAL,Math.max(start,block.number-99),block.number);
  console.log(JSON.stringify(events,(_,v)=>typeof v==='bigint'?v.toString():v,2));
} finally { provider.destroy(); }
