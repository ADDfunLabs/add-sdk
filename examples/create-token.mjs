// Prepares/simulates standard creation. Supply an already prepared creator-bound 1111 salt.
// No vanity search, metadata upload, signing, automatic first buy or broadcast.
import { JsonRpcProvider, ZeroAddress, parseUnits } from 'ethers';
import { AddV1Client } from '@add-fun/sdk';
const chainId=Number(process.env.ADD_CHAIN_ID);
if(![1,56].includes(chainId)||!process.env.ADD_RPC_URL||!process.env.APP_ACCOUNT||!process.env.ADD_PREPARED_SALT)
  throw Error('Set ADD_CHAIN_ID, ADD_RPC_URL, APP_ACCOUNT and ADD_PREPARED_SALT (not a private key).');
const provider=new JsonRpcProvider(process.env.ADD_RPC_URL);
try {
  const add=new AddV1Client(provider,{chainId}),salt=process.env.ADD_PREPARED_SALT;
  const expectedAddress=await add.predictToken('variable-v1',salt);
  const target=await add.getLaunchTarget(ZeroAddress);
  const request=await add.buildCreateToken('variable-v1',process.env.APP_ACCOUNT,{
    name:'Example',symbol:'EX',supply:parseUnits('1000000',18),salt,expectedAddress,
    quoteAsset:ZeroAddress,targetNative:target.targetNative,quoteTarget:target.quoteTarget,
    deadline:BigInt(target.timestamp+300),customTarget:false,
  });
  await add.simulate(request);
  console.log(JSON.stringify({expectedAddress,unsignedTransaction:request},(_,v)=>typeof v==='bigint'?v.toString():v,2));
} finally {provider.destroy();}
