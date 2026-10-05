// SPDX-License-Identifier: GPL-3.0-or-later
// Finite sampling, not a proof about every real-valued placement.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { campaign, campaignFlight } from './check-campaign.mjs';
import { createGameFromLevel, validPlacement } from '../src/state.js';

const measurements=[];
for(const level of campaign.slice(0,5)) {
  const step=level.id==='training-1' ? 1 : 5;
  const regions=level.placement.regions;
  const xs=regions.flatMap(r=>r.kind==='circle' ? [r.x-r.radius,r.x+r.radius] : r.kind==='polygon' ? r.vertices.map(v=>v.x) : [r.xMin,r.xMax]);
  const ys=regions.flatMap(r=>r.kind==='circle' ? [r.y-r.radius,r.y+r.radius] : r.kind==='polygon' ? r.vertices.map(v=>v.y) : [r.yMin,r.yMax]);
  const bounds={xMin:Math.min(...xs),xMax:Math.max(...xs),yMin:Math.min(...ys),yMax:Math.max(...ys)};
  const game=createGameFromLevel(level,{tutorial:false});
  let allowed=0,wins=0,errors=0,minimumWinningClearance=Infinity;
  for(let x=bounds.xMin;x<=bounds.xMax;x+=step) for(let y=bounds.yMin;y<=bounds.yMax;y+=step) {
    if(!validPlacement(game,'planet',x,y)) continue;
    allowed++;
    const m=campaignFlight(level,[{type:'planet',x,y}]).measurement;
    if(m.status==='error') errors++;
    if(m.status==='win') { wins++;minimumWinningClearance=Math.min(minimumWinningClearance,m.clearance); }
  }
  measurements.push({levelId:level.id,step,bounds,allowed,wins,errors,winningFraction:wins/allowed,
    allowedAreaEstimate:allowed*step**2,winningAreaEstimate:wins*step**2,minimumWinningClearance});
  console.log(JSON.stringify(measurements.at(-1)));
}
for(let i=1;i<measurements.length;i++) {
  if(measurements[i].winningFraction >= measurements[i-1].winningFraction) throw Error('Search progression is not increasing');
}
if(measurements[0].wins!==measurements[0].allowed || measurements.some(m=>m.errors)) throw Error('Unexpected sampled failure/error');
const result={campaignSha256:createHash('sha256').update(readFileSync(new URL('../levels/campaign.json',import.meta.url))).digest('hex'),
  method:'closed lattice inside valid placement union; first step 1, others 5; area estimates are counts times step squared, not exact areas or continuous proofs',measurements};
if(process.argv.includes('--write')) writeFileSync(new URL('../levels/campaign-balance.json',import.meta.url),JSON.stringify(result,null,2)+'\n');
