// Real GGUF download, integrity validation and local inference. No mocked model output.
const path=require('node:path');const fs=require('node:fs/promises');const assert=require('node:assert/strict');const {performance}=require('node:perf_hooks');
const {QualityTranslation}=require('../../electron/backend/qualityTranslation.cjs');
async function main(){
 const homeDir=path.resolve(process.env.PAPERDESK_QUALITY_SMOKE_HOME || path.join(__dirname,'../../.cache/quality-smoke'));
 const context={appPaths:{homeDir,dataDir:path.join(homeDir,'data')}};await fs.mkdir(context.appPaths.dataDir,{recursive:true});
 const engine=new QualityTranslation(context);let last=0;
 try{
  await engine.install(p=>{if(Date.now()-last>5000){console.log(JSON.stringify(p));last=Date.now();}});assert.equal((await engine.status()).ready,true);
  const start=performance.now();await engine.start();console.log(JSON.stringify({stage:'startup',platform:process.platform,backend:engine.backend,milliseconds:Math.round(performance.now()-start),manifest:await engine.manifest()}));
  const examples=['The sample size was 20.','The treatment reduced blood pressure by 12% compared with the control group (95% confidence interval, 8-16%; P < 0.05).','The observational study does not establish causality.'];
  for(const [index,text] of examples.entries()){const started=performance.now();const parts=[];const translation=await engine.translate(text,{onDelta:d=>parts.push(d)});assert.match(translation,/[\u3400-\u9fff]/);assert.equal(parts.join(''),translation);for(const number of text.match(/\d+(?:\.\d+)?/g)||[])assert(translation.includes(number),`Original number ${number} missing: ${translation}`);if(index===2)assert.match(translation,/不|未|无法|不能/);console.log(JSON.stringify({sample:index+1,milliseconds:Math.round(performance.now()-started),translation}));}
  const terms=await engine.translate('Lactobacillus was not detected in 20 samples.',{terms:[{source:'Lactobacillus',target:'乳杆菌属'}]});assert(terms.includes('乳杆菌属'));console.log(JSON.stringify({terminology:true,translation:terms}));
  console.log('PASS: actual Hy-MT2 Q4 inference, numbers, negation and custom terminology. Scientific accuracy and RTX3060 performance still require user review.');
 }finally{engine.close();}
}
main().catch(e=>{console.error(e.message);process.exitCode=1});
