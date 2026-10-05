// SPDX-License-Identifier: GPL-3.0-or-later
const cross = (a, b, p) => (b.x-a.x)*(p.y-a.y)-(b.y-a.y)*(p.x-a.x);
const onSegment = (p, a, b) => cross(a,b,p) === 0 &&
  p.x >= Math.min(a.x,b.x) && p.x <= Math.max(a.x,b.x) &&
  p.y >= Math.min(a.y,b.y) && p.y <= Math.max(a.y,b.y);

export function containsPlacement(region, x, y) {
  if (region.kind === 'all') return true;
  if (region.kind === 'circle') return Math.hypot(x-region.x,y-region.y) <= region.radius;
  if (region.kind === 'rect') return x >= region.xMin && x <= region.xMax && y >= region.yMin && y <= region.yMax;
  const p = {x,y}, vertices = region.vertices;
  let inside = false;
  for (let i=0,j=vertices.length-1;i<vertices.length;j=i++) {
    const a=vertices[j], b=vertices[i];
    if (onSegment(p,a,b)) return true;
    if ((a.y>y)!==(b.y>y) && x < (b.x-a.x)*(y-a.y)/(b.y-a.y)+a.x) inside=!inside;
  }
  return inside;
}

export function simplePolygon(vertices) {
  let area=0;
  for(let i=0;i<vertices.length;i++) {
    const a=vertices[i],b=vertices[(i+1)%vertices.length];
    if(a.x===b.x && a.y===b.y) return false;
    area+=a.x*b.y-b.x*a.y;
    // Collinear consecutive edges are rejected, including folds/backtracking.
    if(cross(a,b,vertices[(i+2)%vertices.length])===0) return false;
    for(let j=i+1;j<vertices.length;j++) {
      if(j===i+1 || (i===0 && j===vertices.length-1)) continue;
      const c=vertices[j],d=vertices[(j+1)%vertices.length];
      const abC=cross(a,b,c),abD=cross(a,b,d),cdA=cross(c,d,a),cdB=cross(c,d,b);
      if(onSegment(c,a,b)||onSegment(d,a,b)||onSegment(a,c,d)||onSegment(b,c,d)||
        (Math.sign(abC)!==Math.sign(abD) && Math.sign(cdA)!==Math.sign(cdB))) return false;
    }
  }
  return Number.isFinite(area) && area!==0;
}
