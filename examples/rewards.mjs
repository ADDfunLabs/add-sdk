// Read pending staking/dividend rewards. Public addresses only; no signer or broadcast.
import { JsonRpcProvider } from 'ethers';
import { AddV1Client } from '@add-fun/sdk';
const chainId=Number(process.env.ADD_CHAIN_ID);
if(![1,56].includes(chainId)||!process.env.ADD_RPC_URL||!process.env.APP_ACCOUNT)throw Error('Set ADD_CHAIN_ID, ADD_RPC_URL and APP_ACCOUNT.');
const provider=new JsonRpcProvider(process.env.ADD_RPC_URL);
try {
  const add=new AddV1Client(provider,{chainId}),account=process.env.APP_ACCOUNT;
  const result={};
  if(process.env.ADD_TOKEN)result.dividend=await add.readDividend(process.env.ADD_TOKEN,{account});
  if(process.env.ADD_POOL)result.staking=await add.readStakingPool(process.env.ADD_POOL,{account});
  if(!process.env.ADD_TOKEN&&!process.env.ADD_POOL)throw Error('Set ADD_TOKEN for dividends or ADD_POOL for staking.');
  console.log(JSON.stringify(result,(_,v)=>typeof v==='bigint'?v.toString():v,2));
} finally {provider.destroy();}
