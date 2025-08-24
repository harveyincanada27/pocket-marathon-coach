
let deferredPrompt;
const installBtn = document.getElementById('installBtn');
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  installBtn.style.display = 'inline-block';
});
installBtn.addEventListener('click', async () => {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  await deferredPrompt.userChoice;
  deferredPrompt = null;
  installBtn.style.display = 'none';
});

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('service-worker.js');
}

const raceDateEl = document.getElementById('raceDate');
const baseKmEl = document.getElementById('baseKm');
const peakKmEl = document.getElementById('peakKm');
const runsPerWeekEl = document.getElementById('runsPerWeek');
const longRunPeakEl = document.getElementById('longRunPeak');
const cutbackEl = document.getElementById('cutback');

const generateBtn = document.getElementById('generateBtn');
const saveBtn = document.getElementById('saveBtn');
const clearBtn = document.getElementById('clearBtn');
const exportIcsBtn = document.getElementById('exportIcsBtn');
const planEl = document.getElementById('plan');

let plan = [];

function fmtDate(d){ return d.toLocaleDateString(undefined, {weekday:'short', month:'short', day:'numeric'}); }
function toISODate(d){ return d.toISOString().slice(0,10); }
function pad(n){ return n.toString().padStart(2,'0'); }
function fmtHMS(sec){ const h = Math.floor(sec/3600); const m = Math.floor((sec%3600)/60); const s = Math.floor(sec%60); return h>0?`${h}:${pad(m)}:${pad(s)}`:`${m}:${pad(s)}`; }
function fmtPace(secPerKm){ if (!isFinite(secPerKm) || secPerKm<=0) return ''; const m = Math.floor(secPerKm/60); const s = Math.round(secPerKm%60); return `${m}:${pad(s)}/km`; }
function parseHMS(str){
  if (!str) return null;
  const parts = str.trim().split(':').map(x=>x.trim());
  if (parts.length===1){ const m = parseFloat(parts[0]); return isNaN(m)?null:Math.round(m*60); }
  if (parts.length===2){ const [m,s] = parts.map(Number); if (isNaN(m)||isNaN(s)) return null; return m*60+s; }
  if (parts.length===3){ const [h,m,s] = parts.map(Number); if ([h,m,s].some(isNaN)) return null; return h*3600+m*60+s; }
  return null;
}

function startOfWeekMonday(date){
  const d = new Date(date);
  const day = d.getDay();
  const diff = (day + 6) % 7;
  d.setDate(d.getDate() - diff);
  d.setHours(0,0,0,0);
  return d;
}

function generateWeeklyTargets(weeks, baseKm, peakKm, cutback){
  const targets = [];
  let current = baseKm;
  const peakWeek = Math.floor(weeks*0.7);
  for (let w=0; w<weeks; w++){
    if (cutback && w>0 && w%3===2){
      current = Math.max(baseKm*0.8, Math.round(current*0.8));
    } else if (w < peakWeek){
      const step = Math.max(1, Math.round((peakKm - baseKm)/(peakWeek || 1)));
      current = Math.min(peakKm, current + step);
    } else if (w >= weeks-3){
      current = Math.round(current * (w===weeks-3?0.85 : w===weeks-2?0.7 : 0.4));
    }
    targets.push(current);
  }
  return targets;
}

function distributeWeek(weekKm, runsPerWeek, longPeak){
  const days = new Array(7).fill(null).map(()=>({type:'Rest', km:0, notes:'', done:false, log:null}));
  const runDaysIdx = [1,2,3,5,6];
  const selectedIdx = runDaysIdx.slice(0, runsPerWeek);
  const longDay = 6;
  if (!selectedIdx.includes(longDay)) selectedIdx[selectedIdx.length-1] = longDay;

  const longKm = Math.round(Math.min(longPeak, Math.max(12, weekKm*0.38)));
  const workoutKm = Math.round(Math.max(6, weekKm*0.22));
  let remaining = weekKm - longKm - workoutKm;
  const easyRuns = selectedIdx.filter(i => i!==longDay);
  const perEasy2 = Math.max(5, Math.round(remaining / (easyRuns.length)));

  easyRuns.forEach((idx,j)=>{
    days[idx].type = (j===0 ? 'Workout' : 'Easy');
    days[idx].km = j===0 ? workoutKm : perEasy2;
  });
  days[longDay].type = 'Long';
  days[longDay].km = longKm;
  return days;
}

function render(){
  planEl.innerHTML = '';
  plan.forEach((week, wi)=>{
    const planned = week.days.reduce((s,d)=>s+(d.km||0),0);
    const logged = week.days.reduce((s,d)=>s+(d.log?.actualKm||0),0);
    const cont = document.createElement('div');
    cont.className = 'week card';
    const start = new Date(week.weekStartISO);
    const end = new Date(start); end.setDate(start.getDate()+6);
    cont.innerHTML = `<h3>Week ${wi+1} • ${fmtDate(start)} – ${fmtDate(end)} <span class="totals">Planned: ${planned} km • Logged: ${logged.toFixed(1)} km</span></h3>`;
    week.days.forEach((d, di)=>{
      const row = document.createElement('div');
      row.className = 'day';
      const logLine = d.log ? `<div class="logline">Logged: ${d.log.actualKm?.toFixed(2)} km${d.log.durationSec?` • ${fmtHMS(d.log.durationSec)}`:''}${d.log.paceSecPerKm?` • ${fmtPace(d.log.paceSecPerKm)}`:''}</div>` : '';
      row.innerHTML = `
        <input type="checkbox" ${d.done?'checked':''} data-w="${wi}" data-d="${di}">
        <div>
          <div class="title">${d.type} ${d.km?`• ${d.km} km`:''}</div>
          <div class="meta">${new Date(d.dateISO).toDateString()}</div>
          ${d.notes?`<div class="meta">📝 ${d.notes}</div>`:''}
          ${logLine}
        </div>
        <div class="distance">
          <button class="secondary small" data-edit="${wi}:${di}">Edit</button>
          <button class="small" data-log="${wi}:${di}">Log</button>
        </div>`;
      cont.appendChild(row);
    });
    planEl.appendChild(cont);
  });
}

function attachHandlers(){
  planEl.addEventListener('change', (e)=>{
    if (e.target.type === 'checkbox'){
      const wi = +e.target.dataset.w;
      const di = +e.target.dataset.d;
      plan[wi].days[di].done = e.target.checked;
      saveLocal();
    }
  });
  planEl.addEventListener('click', (e)=>{
    const editBtn = e.target.closest('button[data-edit]');
    const logBtn = e.target.closest('button[data-log]');
    if (editBtn){
      const [wi, di] = editBtn.dataset.edit.split(':').map(Number);
      const day = plan[wi].days[di];
      const newKm = prompt('Planned distance (km):', day.km);
      if (newKm === null) return;
      day.km = Math.max(0, Math.round(+newKm));
      const newType = prompt('Type (Easy / Workout / Long / Rest):', day.type) || day.type;
      day.type = newType;
      const newNotes = prompt('Notes (optional):', day.notes || '') || '';
      day.notes = newNotes;
      saveLocal(); render();
      return;
    }
    if (logBtn){
      const [wi, di] = logBtn.dataset.log.split(':').map(Number);
      const day = plan[wi].days[di];
      const dStr = prompt('Actual distance (km):', day.log?.actualKm ?? day.km ?? '');
      if (dStr === null) return;
      const dist = Math.max(0, parseFloat(dStr)||0);

      const durStr = prompt('Duration (hh:mm:ss or mm:ss; or just minutes like "45"):', day.log? ( (day.log.durationSec?fmtHMS(day.log.durationSec):'') ) : '');
      if (durStr === null) return;
      const durSec = parseHMS(durStr||'');

      let paceSec = null;
      if (dist>0 && durSec && durSec>0){
        paceSec = Math.round(durSec / dist);
      } else {
        const pStr = prompt('Pace (mm:ss per km) (optional):', day.log?.paceSecPerKm?fmtPace(day.log.paceSecPerKm).replace('/km',''):'');
        if (pStr!==null && pStr.trim()!==''){
          const parts = pStr.trim().split(':');
          let sec = null;
          if (parts.length===2){ const [m,s]=parts.map(Number); if (!isNaN(m)&&!isNaN(s)) sec = m*60+s; }
          if (parts.length===1){ const m = Number(parts[0]); if (!isNaN(m)) sec = m*60; }
          if (sec) paceSec = sec;
        }
      }
      day.log = { actualKm: dist, durationSec: durSec||null, paceSecPerKm: paceSec||null };
      if (dist>0) day.done = true;
      saveLocal(); render();
      return;
    }
  });
}

function saveLocal(){
  const settings = {
    raceDate: raceDateEl.value, baseKm: +baseKmEl.value, peakKm: +peakKmEl.value,
    runsPerWeek: +runsPerWeekEl.value, longRunPeak: +longRunPeakEl.value, cutback: (cutbackEl.value==='true')
  };
  localStorage.setItem('pmc_settings', JSON.stringify(settings));
  localStorage.setItem('pmc_plan', JSON.stringify(plan));
}

function loadLocal(){
  try {
    const s = JSON.parse(localStorage.getItem('pmc_settings')||'{}');
    if (s.raceDate) raceDateEl.value = s.raceDate;
    if (s.baseKm) baseKmEl.value = s.baseKm;
    if (s.peakKm) peakKmEl.value = s.peakKm;
    if (s.runsPerWeek) runsPerWeekEl.value = s.runsPerWeek;
    if (s.longRunPeak) longRunPeakEl.value = s.longRunPeak;
    if (typeof s.cutback === 'boolean') cutbackEl.value = String(s.cutback);
    const p = JSON.parse(localStorage.getItem('pmc_plan')||'[]');
    if (Array.isArray(p) && p.length) { plan = p; render(); }
  } catch(e){ console.warn(e); }
}

function generatePlan(){
  if (!raceDateEl.value){ alert('Pick your race date first.'); return; }
  const raceDate = new Date(raceDateEl.value);
  const today = new Date(); today.setHours(0,0,0,0);
  let start = startOfWeekMonday(today);

  const weeks = Math.max(8, Math.ceil((raceDate - start) / (1000*60*60*24*7)));
  const targets = generateWeeklyTargets(weeks, +baseKmEl.value, +peakKmEl.value, cutbackEl.value==='true');
  plan = [];

  for (let w=0; w<weeks; w++){
    const ws = new Date(start); ws.setDate(ws.getDate() + w*7);
    const days = distributeWeek(targets[w], +runsPerWeekEl.value, +longRunPeakEl.value);
    days.forEach((d, i)=>{
      const date = new Date(ws); date.setDate(ws.getDate()+i);
      d.dateISO = toISODate(date);
    });
    plan.push({weekStartISO: toISODate(ws), days});
  }
  saveLocal(); render();
}

function exportICS(){
  if (!plan.length){ alert('Generate or load a plan first.'); return; }
  const lines = ['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Pocket Marathon Coach//EN'];
  plan.forEach(week=>{
    week.days.forEach(d=>{
      if (d.type==='Rest' || d.km===0) return;
      const dt = d.dateISO.replaceAll('-','');
      lines.push('BEGIN:VEVENT');
      lines.push(`UID:${crypto.randomUUID()}@pmc`);
      lines.push(`DTSTAMP:${dt}T080000Z`);
      lines.push(`DTSTART;VALUE=DATE:${dt}`);
      lines.push(`SUMMARY:${d.type} ${d.km} km`);
      const add = [];
      if (d.notes) add.push(d.notes.replace(/\n/g,' '));
      if (d.log){
        const parts=[];
        if (d.log.actualKm) parts.push(`Logged ${d.log.actualKm} km`);
        if (d.log.durationSec) parts.push(fmtHMS(d.log.durationSec));
        if (d.log.paceSecPerKm) parts.push(fmtPace(d.log.paceSecPerKm));
        if (parts.length) add.push(parts.join(' • '));
      }
      if (add.length) lines.push(`DESCRIPTION:${add.join(' | ')}`);
      lines.push('END:VEVENT');
    });
  });
  lines.push('END:VCALENDAR');
  const blob = new Blob([lines.join('\r\n')], {type:'text/calendar'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'marathon_plan.ics';
  a.click();
  URL.revokeObjectURL(url);
}

generateBtn.addEventListener('click', generatePlan);
saveBtn.addEventListener('click', saveLocal);
clearBtn.addEventListener('click', ()=>{
  if (confirm('Clear saved plan & settings?')){
    localStorage.removeItem('pmc_settings');
    localStorage.removeItem('pmc_plan');
    plan = [];
    planEl.innerHTML = '';
  }
});
exportIcsBtn.addEventListener('click', exportICS);

loadLocal();
attachHandlers();
