import './school-batch-worker.js';
import{schoolVisibleNavigation}from'./school-visible-navigation.js';
import{schoolDetailReader}from'./school-detail-reader.js';
import{schoolTrialController}from'./school-trial-controller.mjs';
import{schoolTrialState}from'./school-trial-state.mjs';
const controller=schoolTrialController({store:schoolTrialState(),getTab:tabId=>chrome.tabs.get(tabId),relatedTabs:async listTabId=>(await chrome.tabs.query({})).filter(t=>t.openerTabId===listTabId).map(t=>({id:t.id,openerTabId:t.openerTabId})),scanFunction:schoolVisibleNavigation,openFunction:schoolVisibleNavigation,detailFunction:schoolDetailReader,execute:(tabId,func,args)=>chrome.scripting.executeScript({target:{tabId},world:'ISOLATED',func,args})});
// Keep only child tab IDs/opener relationships for this trial. Never save titles or URLs.
chrome.tabs.onCreated.addListener(tab=>{void controller.observeTab({id:tab.id,openerTabId:tab.openerTabId}).catch(()=>{});});
chrome.runtime.onMessage.addListener((message,sender,reply)=>{
 if(sender.id!==chrome.runtime.id||sender.url!==chrome.runtime.getURL('popup.html')||!message?.type?.startsWith('school-trial-'))return;
 (async()=>{try{await controller.ready;switch(message.type){case'school-trial-status':return{ok:true,status:controller.status()};case'school-trial-check':return{ok:true,status:await controller.check()};case'school-trial-cancel':return{ok:true,status:await controller.cancel()};case'school-trial-restart':return{ok:true,status:await controller.restart(message.tabId,message.schoolId,message.confirmedNoDetail===true)};case'school-trial-start':return{ok:true,status:await controller.start(message.tabId,message.schoolId)};case'school-trial-continue':return{ok:true,status:await controller.continueInTab(message.tabId)};case'school-trial-pause':return{ok:true,status:await controller.pause()};case'school-trial-resume':return{ok:true,status:await controller.resume()};case'school-trial-export':return{ok:true,packet:controller.packet()};default:return{ok:false,code:'INVALID_ACTION'};}}catch{return{ok:false,code:'TRIAL_REQUEST_FAILED'};}})().then(reply);
 return true;
});
