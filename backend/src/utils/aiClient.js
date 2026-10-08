function fabricCooldownMs(err,provider,state){
  // Gemini manages resilience at the API-key level. A shared Redis circuit
  // must never quarantine the whole Gemini lane because one key was limited.
  if(providerGroup(provider)==='google-gemini')return 0;
  if(Number(err?.status)===429 || /rate.?limit|too many requests|quota/i.test(String(err?.message||''))){
    const headerMs=retryAfterMs(err,0);
    if(headerMs>0)return Math.min(FABRIC_QUOTA_MAX_COOLDOWN_MS,Math.max(15000,headerMs));
    if(providerGroup(provider).startsWith('openrouter-free:') || providerGroup(provider).startsWith('openrouter-paid:')){
      // OpenRouter lanes are independently circuit-broken. Keep account-level
      // concurrency shared, but never turn one model failure into a fleet-wide
      // quarantine. The provider state already cools the affected lane.
      return 0;
    }
    return Math.min(RETRYABLE_COOLDOWN_MAX_MS,RETRYABLE_COOLDOWN_BASE_MS*Math.pow(2,Math.min(Number(state.failureCount||0)-1,5)));
  }
  if(Number(err?.status)===402 || /credit balance|billing|insufficient credit|payment required/i.test(String(err?.message||''))){
    return FABRIC_QUOTA_COOLDOWN_MS;
  }
  if(Number(err?.status)===401 || Number(err?.status)===403 || /invalid api key|authentication/i.test(String(err?.message||''))){
    return FABRIC_AUTH_COOLDOWN_MS;
  }
  return 0;
}
function modelCandidates(def){
  return uniqueStrings([
    process.env[def.modelKey],
    def.model,
    ...(Array.isArray(def.fallbackModels)?def.fallbackModels:[]),
    def.free ? 'openrouter/free' : null,
  ]);
}
function resolvedOpenWeightModel(def){
  const candidates=modelCandidates(def);
  const cursor=Math.max(0,Math.min(Number(modelCursors[def.name]||0),Math.max(0,candidates.length-1)));
  return candidates[cursor]||def.model;
}
function isModelNotFound(err){
  return Number(err?.status)===404 ||
    /model[^a-z0-9]*(not found|does not exist|unknown|invalid)|unknown model|no such model|model .* unavailable/i.test(String(err?.message||''));
}
function rotateModel(def){
  const candidates=modelCandidates(def);
  const current=Number(modelCursors[def.name]||0);
  if(current+1<candidates.length){
    modelCursors[def.name]=current+1;
    modelDisabledUntil[def.name]=0;
    logger.warn('AI model lane '+def.name+' rotated from unavailable model to '+resolvedOpenWeightModel(def));
    return true;
  }
  modelDisabledUntil[def.name]=Date.now()+MODEL_UNAVAILABLE_COOLDOWN_MS;
  return false;
}
function providerCooling(providerOrLabel){
  const label=typeof providerOrLabel==='string'?providerOrLabel:providerOrLabel?.name;
  const provider=typeof providerOrLabel==='string'?{name:label}:providerOrLabel;
  const state=states[label];
  const group=providerGroup(provider);
  const fabric=fabricStates[group];
  const modelBlocked=Number(modelDisabledUntil[label]||0);
  return Boolean(
    (state && Date.now()<Number(state.downUntil||0)) ||
    (fabric && Date.now()<Number(fabric.downUntil||0)) ||
    modelBlocked>0 && Date.now()<modelBlocked
  );