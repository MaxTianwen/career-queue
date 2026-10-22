import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {factPalette,factBadges} from '../web/v2/opportunity.js';
import {mountView} from '../web/v2/opportunity-view.js';
// Layout-insensitive: compare rules without whitespace or the optional last semicolon.
const css=readFileSync(new URL('../web/v2/style.css',import.meta.url),'utf8').replace(/\s+/g,'').replace(/;}/g,'}');
function luminance(hex){const rgb=hex.slice(1).match(/../g).map(c=>parseInt(c,16)/255).map(c=>c<=0.04045?c/12.92:((c+0.055)/1.055)**2.4);return rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722;}
test('fixed semantic palettes have explicit text, unique category colours and AA text contrast',()=>{
 assert.deepEqual(Object.keys(factPalette),['season-summer','season-fall','season-winter','months-4','months-8','months-12','months-16','unknown']);
 for(const prefix of ['season-','months-']){const colours=Object.entries(factPalette).filter(([k])=>k.startsWith(prefix)).map(([,v])=>v.background);assert.equal(new Set(colours).size,colours.length);}
 for(const [key,colour] of Object.entries(factPalette)){assert.ok(colour.label);const a=luminance(colour.foreground),b=luminance(colour.background),contrast=(Math.max(a,b)+.05)/(Math.min(a,b)+.05);assert.ok(contrast>=4.5,key+' contrast '+contrast);assert.ok(css.includes('.fact-badges>.fact-'+key+'{color:'+colour.foreground+';background:'+colour.background+'}'),key+' CSS mapping');}
 assert.ok(!css.includes('.fact-badges>.badge:first-child'));assert.ok(css.includes('.fact-badges>.fact-token::before{content:none}'));
});
class N{constructor(tag){this.tag=tag;this.children=[];this.events={};this.attrs={};this.className='';this.classList={contains:c=>this.className.split(' ').includes(c),toggle:(c,on)=>{this.className=this.className.split(' ').filter(x=>x!==c).concat(on?[c]:[]).join(' ');}};}setAttribute(k,v){this.attrs[k]=v;}addEventListener(k,v){this.events[k]=v;}append(...children){for(const c of children){c.remove?.();this.children.push(c);c.parentNode=this;}}remove(){if(this.parentNode)this.parentNode.children=this.parentNode.children.filter(c=>c!==this);this.parentNode=null;}querySelector(){return null;}insertBefore(c,target){c.parentNode=this;this.children.splice(this.children.indexOf(target),0,c);}matches(selector){return selector.split(',').some(s=>s.startsWith('.')?this.classList.contains(s.slice(1)):this.tag===s);}}
function dom(fn){const before=[globalThis.document,globalThis.localStorage];globalThis.document={createElement:t=>new N(t)};globalThis.localStorage={getItem:()=> 'table',setItem(){}};try{fn();}finally{[globalThis.document,globalThis.localStorage]=before;}}
const tokens=box=>box.children.filter(n=>n.classList.contains('fact-token')).map(n=>[n.textContent,n.className]);
test('multiple terms and months each receive their own stable labelled token; unknown remains neutral',()=>dom(()=>{
 const box=factBadges({term:'Summer / Fall 2027, 4/8/12 months'});assert.deepEqual(tokens(box).map(x=>x[0]),['Summer 2027','Fall 2027','4 个月','8 个月','12 个月']);assert.equal(new Set(tokens(box).map(x=>x[1])).size,5);
 const missing=factBadges({term:'8 weeks'});assert.deepEqual(tokens(missing),[['学期／年份未知','badge fact-token fact-unknown'],['8 周','badge fact-token fact-unknown']]);assert.ok(!missing.children.some(n=>n.className==='duration-warning'||n.className==='duration-evidence'));assert.ok(!tokens(missing).some(([label])=>label==='8 个月'));
 assert.deepEqual(tokens(factBadges({term:'Winter 2027, 16 months'})).map(x=>x[0]),['Winter 2027','16 个月']);
}));
test('school and discovery use identical colours and table conversion preserves exact token nodes',()=>dom(()=>{
 const job={term:'Summer / Fall, 4/8/12 months'},publicBox=factBadges(job),schoolBox=factBadges({...job,hasSchool:true});assert.deepEqual(tokens(publicBox),tokens(schoolBox));
 const parent=new N('div'),list=new N('div');parent.append(list);for(const box of [publicBox,schoolBox]){const card=new N('article');card.className='recommendation-card';card.append(box);list.append(card);}mountView(list,'colours',()=>{})();const rows=list.children[0].children[0].children[2].children;assert.equal(rows[0].children[2].children[0],publicBox);assert.equal(rows[1].children[2].children[0],schoolBox);assert.deepEqual(tokens(publicBox),tokens(schoolBox));
}));
