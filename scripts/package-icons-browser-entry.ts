import {createApp,h} from 'vue'
import PackageIcon from '../src/components/PackageIcon.vue'
import {dsm} from '../src/api/dsm'
export function mount(){
 dsm.baseUrl='https://fixture-nas';dsm.account='fixture'
 ;(window as any).__TAURI_INTERNALS__={invoke:async()=>{throw Error('offline')}}
 createApp({render:()=>h('div',{style:'display:flex;gap:16px;padding:24px'},[
  h(PackageIcon,{pkg:{id:'SynologyDrive',name:'Drive'}}),
  h(PackageIcon,{pkg:{id:'SynologyPhotos',name:'Photos',icon:'https://fixture-nas/broken.png'}}),
  h(PackageIcon,{pkg:{id:'Virtualization',name:'VMM'}}),
  h(PackageIcon,{pkg:{id:'other',name:'Unknown'}}),
 ])}).mount('#app')
}
