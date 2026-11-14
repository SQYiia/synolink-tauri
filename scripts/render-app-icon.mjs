import {chromium} from 'playwright'
import {readFile,writeFile} from 'node:fs/promises'
const svg=await readFile('public/synolink-icon.svg','utf8')
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true})
try{const page=await browser.newPage();const png=await page.evaluate(async svg=>{const image=new Image();image.src='data:image/svg+xml;base64,'+btoa(svg);await image.decode();const canvas=document.createElement('canvas');canvas.width=canvas.height=1024;canvas.getContext('2d').drawImage(image,0,0);return canvas.toDataURL('image/png').split(',')[1]},svg);await writeFile('public/synolink-icon-1024.png',Buffer.from(png,'base64'))}finally{await browser.close()}
