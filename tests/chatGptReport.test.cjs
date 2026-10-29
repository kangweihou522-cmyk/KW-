const test = require('node:test'); const assert = require('node:assert/strict'); const fs = require('node:fs/promises'); const path = require('node:path'); const os = require('node:os');
const { createLibraryStore } = require('../electron/backend/libraryStore.cjs'); const { createReferenceExchangeCommands } = require('../electron/backend/referenceExchangeCommands.cjs'); const { createNoteStore } = require('../electron/backend/noteStore.cjs'); const { createChatGptCommands } = require('../electron/backend/chatGptCommands.cjs');
async function fixture(t, complete) {
 const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'paperdesk-connected-report-')); const appPaths = { dataDir, configPath: path.join(dataDir,'.settings','config.json'), libraryDatabasePath: path.join(dataDir,'library.sqlite'), libraryPath:path.join(dataDir,'library.json'),notesDatabasePath:path.join(dataDir,'notes.sqlite') };
 const store = createLibraryStore(appPaths); const noteStore = createNoteStore(appPaths); const file=path.join(dataDir,'fictional-evidence.txt'); await fs.writeFile(file,'Fictional study only. n=20. No real scientific claim.');
 const reference=createReferenceExchangeCommands({store,appPaths}); await reference.library_import_references({format:'ris',content:'TY  - JOUR\nTI  - Fictional study\nER  - \n'}); const paper=store.load().papers[0]; await reference.library_add_supplement({paperId:paper.id,paths:[file]});
 const commands=createChatGptCommands({store,noteStore,appPaths,chatGptBridge:{complete},app:{once(){}}});
 t.after(async()=>{noteStore.close();store.close();await fs.rm(dataDir,{recursive:true,force:true})});return{commands,store,noteStore,appPaths,paper};
}
test('connected reports include registered evidence, save one local note, and reuse it without another model call',async t=>{
 let calls=0; const f=await fixture(t,async prompt=>{calls++; assert(prompt.includes('n=20'));assert(prompt.includes('fictional-evidence.txt'));return '# 虚构概览\n\n仅测试资料传输与保存，不验证科研质量。'});
 const [a,b]=await Promise.all([f.commands.chatgpt_generate_report({paperId:f.paper.id}),f.commands.chatgpt_generate_report({paperId:f.paper.id})]);
 assert.equal(calls,1);assert.equal(a.note.id,b.note.id);assert.equal(f.noteStore.listNotes({paperId:f.paper.id}).length,1);
 assert(f.store.load().papers[0].aiSummary.includes('虚构概览'));
 assert.equal((await f.commands.chatgpt_generate_report({paperId:f.paper.id})).cached,true);assert.equal(calls,1);
 const c=await f.commands.chatgpt_generate_report({paperId:f.paper.id,force:true});assert.equal(c.note.id,a.note.id);assert.equal(calls,2);
});
test('a connected report cannot overwrite a note edited while the model was running',async t=>{
 let release;let started;const ready=new Promise(resolve=>{started=resolve});
 const f=await fixture(t,async()=>{started();return new Promise(resolve=>{release=resolve})});
 const original=f.noteStore.createNote({paperId:f.paper.id,title:'Original',type:'ai-chat',content:'Keep my edits',tags:['读书报告','ChatGPT手动回填']});
 const pending=f.commands.chatgpt_generate_report({paperId:f.paper.id,force:true});const rejected=assert.rejects(pending,/未覆盖/);await ready;
 f.noteStore.updateNote({id:original.id,patch:{content:'New manual edit'}});release('Generated fictional report');await rejected;
 assert.equal(f.noteStore.getNote({id:original.id}).content,'New manual edit');assert.equal((await fs.readdir(path.join(f.appPaths.dataDir,'.chatgpt-reports'))).length,1);
});
