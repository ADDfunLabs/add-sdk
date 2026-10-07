// Builds and simulates a buy; NEVER signs or broadcasts. APP_ACCOUNT is a PUBLIC address, not a key.
import { JsonRpcProvider, parseEther } from 'ethers';
import { AddV1Client } from '@add-fun/sdk';
const chainId=Number(process.env.ADD_CHAIN_ID);
if(![1,56].includes(chainId)||!process.env.ADD_RPC_URL||!process.env.ADD_TOKEN||!process.env.APP_ACCOUNT)throw Error('Set ADD_CHAIN_ID (1 or 56), ADD_RPC_URL, ADD_TOKEN and APP_ACCOUNT.');
const provider=new JsonRpcProvider(process.env.ADD_RPC_URL);
try {
  const add=new AddV1Client(provider,{chainId}),quote=await add.quoteBuy(process.env.ADD_TOKEN,parseEther('0.01'));
  const tx=await add.buildSwap(quote,process.env.APP_ACCOUNT,{deadline:BigInt(quote.timestamp+300)});
  await add.simulate(tx);
  console.log(JSON.stringify({quote,unsignedTransaction:tx},(_,v)=>typeof v==='bigint'?v.toString():v,2));
  // Your application separately obtains user consent and passes tx to its wallet signer.
} finally { provider.destroy(); }
