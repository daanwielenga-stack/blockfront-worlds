/**
 * Monetization adapter.
 *
 * Ads are OFF by default. In production, enable with environment variables:
 * ADS_ENABLED=1
 * ADS_PROVIDER=adsense
 * ADSENSE_CLIENT=ca-pub-...
 * ADSENSE_MENU_SLOT=...
 *
 * The active-game canvas never contains ad units. This module only exposes
 * menu and natural-break placements so the provider can be swapped later.
 */
let config = {enabled:false, provider:'placeholder'};
let scriptLoaded = false;

function loadAdSense(client){
  if(scriptLoaded || !client) return;
  scriptLoaded = true;
  const s=document.createElement('script');
  s.async=true;
  s.crossOrigin='anonymous';
  s.src=`https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(client)}`;
  document.head.appendChild(s);
}

function renderAdSense(container, slot){
  if(!container || !slot || !config.adsense_client) return false;
  container.innerHTML='';
  const ins=document.createElement('ins');
  ins.className='adsbygoogle';
  ins.style.display='block';
  ins.dataset.adClient=config.adsense_client;
  ins.dataset.adSlot=slot;
  ins.dataset.adFormat='auto';
  ins.dataset.fullWidthResponsive='true';
  container.appendChild(ins);
  try{ (window.adsbygoogle=window.adsbygoogle||[]).push({}); }catch{}
  return true;
}

export function initAds(siteConfig){
  config = siteConfig?.ads || config;
  const menu=document.querySelector('#menuAd');
  if(!config.enabled){ menu?.classList.add('hidden'); return; }
  menu?.classList.remove('hidden');
  if(config.provider==='adsense'){
    loadAdSense(config.adsense_client);
    const content=document.querySelector('#menuAdContent');
    setTimeout(()=>{
      if(!renderAdSense(content,config.menu_slot) && content) content.textContent='Ad slot configured after publisher approval';
    },300);
  }
}

export function setGameplayActive(active){
  const menu=document.querySelector('#menuAd');
  if(!config.enabled || !menu) return;
  menu.classList.toggle('hidden',active);
}

export function prepareNaturalBreak(){
  const wrap=document.querySelector('#breakAd');
  const content=document.querySelector('#breakAdContent');
  if(!config.enabled || !wrap){ wrap?.classList.add('hidden'); return; }
  wrap.classList.remove('hidden');
  // Do not repurpose a normal content-ad unit as an in-game interstitial.
  // H5/full-screen game ads have their own provider API and policy rules.
  // This surface is intentionally only reserved until that integration is
  // approved and configured.
  if(content){
    content.textContent=config.provider==='adsense'
      ? 'Reserved for an approved H5 natural-break integration'
      : 'Natural-break advertising surface';
  }
}
