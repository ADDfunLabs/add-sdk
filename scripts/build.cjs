const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'),tsc=require.resolve('typescript/bin/tsc');
for(const [format,module] of [['esm','ES2022'],['cjs','CommonJS']]){
 const out=path.join(root,'dist',format);
 const result=spawnSync(process.execPath,[tsc,'-p',path.join(root,'tsconfig.json'),'--module',module,'--outDir',out],{stdio:'inherit',cwd:root});
 if(result.status!==0)process.exit(result.status||1);
 fs.writeFileSync(path.join(out,'package.json'),JSON.stringify({type:format==='esm'?'module':'commonjs'})+'\n');
}
