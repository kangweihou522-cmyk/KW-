const test = require('node:test'); const assert = require('node:assert/strict'); const fs = require('node:fs/promises'); const path = require('node:path'); const os = require('node:os');
const {createNoteStore}=require('../electron/backend/noteStore.cjs');const {createNoteCommands}=require('../electron/backend/noteCommands.cjs');
test('overview sections, drafts, deleted headings and all revisions survive restart, while stale windows cannot overwrite',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'paperdesk-documents-'));const paths={notesDatabasePath:path.join(dir,'notes.sqlite')};let store=createNoteStore(paths);t.after(async()=>{store.close();await fs.rm(dir,{recursive:true,force:true})});
 const initial=[{id:'team',title:'团队简介',content:'虚构团队'},{id:'custom',title:'研究设计',content:'手工编辑'}];
 assert.equal(store.getDocument('paper-a').version,0);
 const first=store.saveDocument({paperId:'paper-a',content:initial,expectedVersion:0});assert.equal(first.version,1);
 store.saveDocumentDraft({paperId:'paper-a',content:[initial[1]],baseVersion:1,sourceId:'window-a'});
 store.saveDocumentDraft({paperId:'paper-a',content:initial,baseVersion:1,sourceId:'window-b'});
 store.saveDocument({paperId:'paper-a',content:[initial[1]],expectedVersion:1,sourceId:'window-a'});
 assert.throws(()=>store.saveDocument({paperId:'paper-a',content:initial,expectedVersion:1}),/其他窗口/);
 store.close();store=createNoteStore(paths);assert.deepEqual(store.getDocument('paper-a').content,[initial[1]]);assert.equal(store.getDocument('paper-a').drafts.length,1);assert.equal(store.documentHistory('paper-a').length,2);assert.deepEqual(store.documentHistory('paper-a')[1].content,initial);assert.equal(store.getDocument('paper-b').version,0);
});
test('report history includes pre-upgrade notes and restore saves a new revision instead of deleting edits',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'paperdesk-revisions-'));const store=createNoteStore({notesDatabasePath:path.join(dir,'notes.sqlite')});t.after(async()=>{store.close();await fs.rm(dir,{recursive:true,force:true})});
 const commands=createNoteCommands({noteStore:store});const original=store.createNote({paperId:'p',title:'Report',content:'Original report'});const next=store.updateNote({id:original.id,patch:{content:'Manual edit'}});
 const versions=commands.notes_versions({id:original.id});assert.equal(versions.length,2);assert.equal(versions[0].note.content,'Manual edit');
 assert.throws(()=>commands.notes_restore_version({id:original.id,versionId:versions[1].id,expectedUpdatedAt:next.updatedAt,expectedContent:'stale'}),/变更/);
 const restored=commands.notes_restore_version({id:original.id,versionId:versions[1].id,expectedUpdatedAt:next.updatedAt,expectedContent:next.content});assert.equal(restored.content,'Original report');assert.equal(commands.notes_versions({id:original.id}).length,3);
});
