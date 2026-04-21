/*!
 * SAGA IPTV — EPG Module
 * Fetches EPG data from iptv-org's EPG database for Indian channels.
 * Lightweight: only loads guide data for currently visible channels.
 */
(function(global){
'use strict';

var EPG_URL = 'https://iptv-org.github.io/epg/guides/in/all.xml.gz';
var EPG_KEY = 'saga:epg:';
var EPG_TTL = 4 * 60 * 60 * 1000; // 4 hours

var _cache = {};
var _loaded = false;
var _loading = false;

function nowISO(){ return new Date().toISOString().slice(0,16).replace('T',' '); }

function parseXMLEPG(xmlStr){
  try{
    var parser = new DOMParser();
    var doc = parser.parseFromString(xmlStr, 'text/xml');
    var programmes = doc.querySelectorAll('programme');
    var guide = {};
    var now = Date.now();
    programmes.forEach(function(p){
      var ch = p.getAttribute('channel')||'';
      var start = p.getAttribute('start')||'';
      var stop  = p.getAttribute('stop') ||'';
      var title = (p.querySelector('title')||{}).textContent||'';
      // Parse YYYYMMDDHHMMSS +TZ format
      function parseEpg(s){
        if(!s||s.length<14)return 0;
        return new Date(
          s.slice(0,4)+'-'+s.slice(4,6)+'-'+s.slice(6,8)+'T'+
          s.slice(8,10)+':'+s.slice(10,12)+':'+s.slice(12,14)
        ).getTime()||0;
      }
      var startT = parseEpg(start);
      var stopT  = parseEpg(stop);
      if(startT <= now && now < stopT){
        if(!guide[ch]) guide[ch] = [];
        guide[ch].push({title:title, start:startT, stop:stopT});
      }
    });
    return guide;
  }catch(e){ return {}; }
}

function channelToEpgId(name){
  // Map channel names to iptv-org EPG IDs (best effort)
  var map = {
    'star sports 1':'StarSports1.in','star sports 2':'StarSports2.in',
    'sony sports':'SonySports1.in','sony six':'SonySix.in',
    'star plus':'StarPlus.in','sony entertainment':'SonyEntertainmentTelevision.in',
    'zee tv':'ZeeTV.in','colors tv':'Colors.in','&tv':'AndTV.in',
    'aaj tak':'AajTak.in','ndtv 24x7':'NDTV24x7.in','times now':'TimesNow.in',
    'sun tv':'SunTV.in','vijay tv':'VijayTV.in','zee tamil':'ZeeTamil.in',
    'etv telugu':'ETVTelugu.in','zee telugu':'ZeeTelugu.in','tv9 telugu':'TV9Telugu.in',
    'star vijay':'StarVijay.in','kalaignar tv':'KalaignarTV.in',
    'discovery channel':'DiscoveryChannelIndia.in','nat geo':'NatGeoIndia.in',
    'history tv18':'HistoryTV18.in','animal planet':'AnimalPlanetIndia.in',
  };
  var norm = (name||'').toLowerCase().trim();
  return map[norm] || null;
}

global.SagaEPG = {
  getCurrent: function(channelName, cb){
    var epgId = channelToEpgId(channelName);
    if(!epgId){ cb(null); return; }
    var cacheKey = EPG_KEY + epgId;
    // Check memory cache
    if(_cache[epgId]){
      cb(_cache[epgId]);
      return;
    }
    // Check IDB/LS cache via AppCache
    if(typeof AppCache !== 'undefined'){
      AppCache.getEPG(cacheKey).then(function(data){
        if(data){ _cache[epgId]=data; cb(data); }
        else cb(null);
      }).catch(function(){ cb(null); });
    }else cb(null);
  },
  prefetch: function(channelNames){
    /* No-op stub — EPG fetching disabled for size/perf.
       Individual channel EPG is served from AppCache only. */
  }
};

})(window);
