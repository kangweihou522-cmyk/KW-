// Real GGUF download, integrity validation and local inference. No mocked model output.
const path=require('node:path');const fs=require('node:fs/promises');const assert=require('node:assert/strict');const {performance}=require('node:perf_hooks');
const {QualityTranslation}=require('../../electron/backend/qualityTranslation.cjs');
async function main(){
 const homeDir=path.resolve(process.env.PAPERDESK_QUALITY_SMOKE_HOME || path.join(__dirname,'../../.cache/quality-smoke'));
 const context={appPaths:{homeDir,dataDir:path.join(homeDir,'data')}};await fs.mkdir(context.appPaths.dataDir,{recursive:true});
 const engine=new QualityTranslation(context);let last=0;let startupAt=0;let startupMs=0;
 try{
  await engine.install(p=>{if(p.stage==='start')startupAt=performance.now();if(p.stage==='ready'&&startupAt)startupMs=performance.now()-startupAt;if(Date.now()-last>5000){console.log(JSON.stringify(p));last=Date.now();}});assert.equal((await engine.status()).ready,true);
  const start=performance.now();await engine.start();console.log(JSON.stringify({stage:'startup',platform:process.platform,backend:engine.backend,milliseconds:Math.round(startupMs || performance.now()-start),manifest:await engine.manifest()}));
  const examples=['The sample size was 20.','The treatment reduced blood pressure by 12% compared with the control group (95% confidence interval, 8-16%; P < 0.05).','The observational study does not establish causality.'];
  for(const [index,text] of examples.entries()){const started=performance.now();const parts=[];const translation=await engine.translate(text,{onDelta:d=>parts.push(d)});assert.match(translation,/[\u3400-\u9fff]/);assert.equal(parts.join(''),translation);for(const number of text.match(/\d+(?:\.\d+)?/g)||[])assert(translation.includes(number),`Original number ${number} missing: ${translation}`);if(index===2)assert.match(translation,/不|未|无法|不能/);console.log(JSON.stringify({sample:index+1,milliseconds:Math.round(performance.now()-started),translation}));}
  const terms=await engine.translate('Lactobacillus was not detected in 20 samples.',{terms:[{source:'Lactobacillus',target:'乳杆菌属'}]});assert(terms.includes('乳杆菌属'));console.log(JSON.stringify({terminology:true,translation:terms}));
  const word=await engine.translate('Capsaicinoids',{context:'Capsaicinoids were tested in 384 broilers to evaluate growth performance.',selectionFragment:true});assert.match(word,/[\u3400-\u9fff]/);assert(word.length<100 && !word.includes('384'),'Word translation included the surrounding sentence');
  console.log('PASS: real native selected-word translation uses context without translating it.');
  const selected='Dietary irritants stimulate the nervous system and provoke somatosensory responses. The sample size was 20, and the study does not establish causality.';
  const exactRange=await engine.translate(selected,{context:selected+' Introduction. This unselected section discusses 384 broilers.',selectionFragment:true});
  assert.match(exactRange,/[\u3400-\u9fff]/);assert(exactRange.includes('20'));assert.match(exactRange,/不|未|无法|不能/);assert(!exactRange.includes('384'),'Multi-sentence translation included unselected introduction');
  console.log('PASS: real native multi-sentence selection preserves numbers/negation and excludes the unselected introduction.');
  const probe=require('node:net').createServer();await new Promise(resolve=>probe.listen(0,'127.0.0.1',resolve));const stalePort=probe.address().port;await new Promise(resolve=>probe.close(resolve));engine.port=stalePort;
  engine.download=async()=>{throw new Error('Connection recovery must reuse installed weights');};let resets=0;
  const recovered=await engine.translate('The sample size was 20.',{onReset:()=>resets++});assert.equal(resets,1);assert.match(recovered,/[\u3400-\u9fff]/);assert(recovered.includes('20'));
  console.log('PASS: real native stale-connection recovery restarts once and reuses installed model weights.');
  const {TranslationMemory}=require('../../electron/backend/translationMemory.cjs');
  const {translateAbstract}=require('../../electron/backend/preparationAutofill.cjs');
  let autofillCalls=0;
  const memory=new TranslationMemory({...context,qualityTranslation:{lock:engine.lock,translate:async(...args)=>{autofillCalls++;return engine.translate(...args);}}});
  const options={documentId:'native-autofill-smoke',source:'English',target:'Chinese',background:true};
  const title=await memory.translate('Effects of dietary capsaicinoids on broiler growth performance',options);assert.match(title.translation,/[\u3400-\u9fff]/);
  const abstract={text:'The sample size was 20. The observational study does not establish causality.',pageIndex:0};
  const translated=await translateAbstract(abstract,memory,options);assert.match(translated.translation,/[\u3400-\u9fff]/);assert(translated.translation.includes('20'));assert.match(translated.translation,/不|未|无法|不能/);
  const calls=autofillCalls;const repeated=await translateAbstract(abstract,memory,options);assert.equal(repeated.cached,2);assert.equal(autofillCalls,calls);assert.equal(repeated.translation,translated.translation);
  console.log('PASS: real native Chinese-title/original-abstract translation, preserved number/negation, and repeat abstract uses cache without inference.');
  console.log('PASS: actual Hy-MT2 Q4 inference, numbers, negation and custom terminology. Scientific accuracy and RTX3060 performance still require user review.');
 }finally{engine.close();}
}
main().catch(e=>{console.error(e.message);process.exitCode=1});
