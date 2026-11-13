import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {createHash} from 'node:crypto'
import ts from 'typescript'
const exports={};new Function('exports',ts.transpileModule(readFileSync('src/utils/officialPackageIcons.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(exports)
const {officialPackageIcon,officialPackageIcons}=exports
test('official fallback uses exact IDs and excludes community and name impersonation',()=>{
 assert.equal(officialPackageIcon({id:'SynologyDrive'}),'/package-icons/drive.png')
 assert.equal(officialPackageIcon({id:'Virtualization'}),'/package-icons/virtual_machine_manager.png')
 for(const pkg of [{id:'other',name:'Synology Drive'},{id:'SynologyDrive',sourceKind:'community'},{id:'toString'},{id:'../../secret'}])assert.equal(officialPackageIcon(pkg),'')
})
test('every mapped official icon is bundled, valid PNG and matches recorded source checksum',()=>{
 const sources=JSON.parse(readFileSync('public/package-icons/sources.json','utf8'))
 for(const id of new Set(Object.values(officialPackageIcons))){const bytes=readFileSync(`public/package-icons/${id}.png`),source=sources.find(s=>s.id===id);assert.ok(source);assert.ok(source.source.startsWith('https://design.synology.com/assets/'));assert.equal(bytes.subarray(0,8).toString('hex'),'89504e470d0a1a0a');assert.equal(createHash('sha256').update(bytes).digest('hex'),source.sha256)}
})
