const test=require('node:test');const assert=require('node:assert/strict');const {QualityTranslation,translationPrompt,chunkText}=require('../electron/backend/qualityTranslation.cjs');const {isFreeModel,FreeReportProvider}=require('../electron/backend/freeReportProvider.cjs');
test('Hy-MT2 resolves only official Q4_K_M weights with immutable commit, byte size and SHA256',async()=>{
 const model={sha:'a'.repeat(40),siblings:[{rfilename:'Hy-MT2-1.8B-Q4_K_M.gguf',lfs:{sha256:'b'.repeat(64),size:1200000000}},{rfilename:'unsafe-Q2.gguf'}]};
 const engine=new QualityTranslation({appPaths:{dataDir:'/unused'},qualityJson:async()=>model});const resolved=await engine.resolveModel();assert(resolved.url.includes('tencent/Hy-MT2-1.8B-GGUF/resolve/'+model.sha));assert.equal(resolved.bytes,1200000000);assert.equal(resolved.sha256,'b'.repeat(64));
 delete model.siblings[0].lfs.sha256;await assert.rejects(engine.resolveModel(),/校验值/);
});
test('translation chunks retain the final segment and terminology instructions remain source-specific',()=>{
 const input=Array.from({length:1300},(_,i)=>`token${i}`).join(' ');assert.equal(chunkText(input).join(''),input);assert(chunkText(input).every(c=>c.length<=1600));
 const prompt=translationPrompt('Lactobacillus was not detected in 20 samples.',{terms:[{source:'Lactobacillus',target:'乳杆菌属'},{source:'unrelated',target:'不相关'}]});assert(prompt.includes('Lactobacillus → 乳杆菌属'));assert(!prompt.includes('unrelated'));assert(prompt.includes('not detected in 20'));
});
test('free report catalog excludes charged or unpriced models even if their names contain free',()=>{
 assert.equal(isFreeModel({id:'vendor/model:free',pricing:{prompt:'0',completion:'0'}}),true);
 for(const model of [{id:'vendor/model',pricing:{prompt:'0',completion:'0'}},{id:'vendor/model:free',pricing:{prompt:'0.001',completion:'0'}},{id:'vendor/model:free'}])assert.equal(isFreeModel(model),false);
});
