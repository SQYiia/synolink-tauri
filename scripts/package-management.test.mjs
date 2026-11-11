import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import ts from 'typescript'
const exports={};new Function('exports','require',ts.transpileModule(readFileSync(new URL('../src/utils/packageManagement.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText)(exports,()=>({apiError:c=>'NAS error '+c}))
test('package results reject nested failures instead of claiming success',()=>{for(const r of [{success:false,error:{code:105}},{success:true,data:{has_fail:true}},{success:true,data:{result:[{success:false,error:{code:400}}]}},{success:true,data:{success:false}}])assert.throws(()=>exports.packageResult(r));assert.deepEqual(exports.packageResult({success:true,data:{version:'1'}}),{version:'1'})})
test('package version comparison is numeric and never treats downgrades as updates',()=>{assert.equal(exports.newerPackage('1.10-100','1.9-99'),true);assert.equal(exports.newerPackage('1.0','2.0'),false);assert.equal(exports.newerPackage('2.0','2.0.0'),false);assert.equal(exports.newerPackage('2.0-beta','1.0'),false)})
test('custom installation pages, signature errors, dependency replacements and occupied volumes require attention',()=>{for(const info of [{codesign_error:4532},{additional:{install_pages:[{}]}},{additional:{replace_pkgs:{old:''}}},{install_reboot:true}])assert.ok(exports.installationBlock(info,{}));assert.ok(exports.installationBlock({}, {is_occupied:true}));assert.equal(exports.installationBlock({id:'demo'},{}),'')})

test('empty DSM wizard and dependency fields do not block installation', () => {
 for (const value of [undefined, null, false, 0, '', 'false', '0', [], {}, '[]', '{}']) {
  assert.equal(exports.installationBlock({install_pages:value, additional:{dependent_packages:value}}, {wizard:value}), '')
 }
 assert.ok(exports.installationBlock({install_pages:[{title:'Setup'}]},{}))
})
test('catalog search accepts localized name, identifier and descriptions', () => {
 const pkg={name:'工具',dname:'Tools',id:'CommunityDemo',description:'Media server'}
 for(const term of ['communitydemo',' tools ', 'MEDIA']) assert.equal(exports.packageMatches(pkg,term),true)
 assert.equal(exports.packageMatches(pkg,'unrelated'),false)
})
