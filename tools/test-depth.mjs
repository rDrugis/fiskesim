import { solveDepth, DYBDELAG } from '../src/data/depthmodel.js';
const W = 600, H = 600, res = 4;
// "sann" bunn: fjord med land i nord og sør, en grunne midt i, en dyp renne
const trueD = new Float32Array(W*H);
for (let j=0;j<H;j++) for (let i=0;i<W;i++) {
  const x = i*res, y = j*res; // m
  const distN = y, distS = H*res - y;
  const shore = Math.min(distN, distS) - 300 - 80*Math.sin(x/200);
  let d = shore < 0 ? -2 : Math.min(180, shore*0.35 + 3*Math.sin(x/37)*Math.cos(y/53));
  const dx = x - 1200, dy = y - 1250; const r = Math.hypot(dx, dy);
  d -= Math.max(0, 70 - r*0.25); // grunne
  if (shore >= 0) d = Math.max(0.6, d);
  trueD[j*W+i] = d;
}
// maske og klasser
const mask = new Uint8Array(W*H), cls = new Int8Array(W*H).fill(-1);
for (let p=0;p<W*H;p++) { const d = trueD[p]; if (d < 0) continue; mask[p] = 1; for (let k=0;k<DYBDELAG.length;k++) if (d >= DYBDELAG[k][1] - 0.5 && d < DYBDELAG[k][2]) { cls[p] = k; break; } }
// prior: 50 m blokkgjennomsnitt, bilineært tilbake
const B = 50/res, bw = Math.ceil(W/B), bh = Math.ceil(H/B), blk = new Float32Array(bw*bh);
for (let J=0;J<bh;J++) for (let I=0;I<bw;I++) { let s=0,n=0; for (let j=J*B;j<Math.min(H,(J+1)*B);j++) for (let i=I*B;i<Math.min(W,(I+1)*B);i++) { const d=trueD[Math.floor(j)*W+Math.floor(i)]; if (d>0){s+=d;n++;} } blk[J*bw+I] = n>B*B*0.5? s/n : NaN; }
const prior = new Float32Array(W*H);
for (let j=0;j<H;j++) for (let i=0;i<W;i++) { const fx=(i+0.5)/B-0.5, fy=(j+0.5)/B-0.5; const I=Math.max(0,Math.min(bw-1,Math.round(fx))), J=Math.max(0,Math.min(bh-1,Math.round(fy))); prior[j*W+i]=NaN; }
// bilineær prior
for (let j=0;j<H;j++) for (let i=0;i<W;i++) { const fx=(i+0.5)/B-0.5, fy=(j+0.5)/B-0.5; const I0=Math.max(0,Math.min(bw-1,Math.floor(fx))), J0=Math.max(0,Math.min(bh-1,Math.floor(fy))); const I1=Math.min(bw-1,I0+1), J1=Math.min(bh-1,J0+1); const tx=Math.max(0,Math.min(1,fx-I0)), ty=Math.max(0,Math.min(1,fy-J0)); let s=0,w=0; for (const [I,J,ww] of [[I0,J0,(1-tx)*(1-ty)],[I1,J0,tx*(1-ty)],[I0,J1,(1-tx)*ty],[I1,J1,tx*ty]]) { const v=blk[J*bw+I]; if (v===v){s+=v*ww;w+=ww;} } prior[j*W+i]= w>0.01? s/w : NaN; }
// punkter: 400 tilfeldige lodd
const pts=[]; let seed=1; const rnd=()=>{seed=(seed*16807)%2147483647;return seed/2147483647;};
for (let k=0;k<400;k++){ const i=rnd()*W, j=rnd()*H; const d=trueD[Math.floor(j)*W+Math.floor(i)]; if (d>0) pts.push(i,j,d); }
const t0=performance.now();
const r = solveDepth({W,H,res,mask,cls,prior,points:pts,rocks:[]});
const t1=performance.now();
let se=0,n=0,maxe=0, seP=0;
for (let p=0;p<W*H;p++){ if(mask[p]!==1) continue; const e=r.depth[p]-trueD[p]; se+=e*e; n++; maxe=Math.max(maxe,Math.abs(e)); const ep=(prior[p]===prior[p]?prior[p]:0)-trueD[p]; seP+=ep*ep; }
console.log('ms',Math.round(t1-t0),'rmse',Math.sqrt(se/n).toFixed(2),'max',maxe.toFixed(1),'prior-only rmse',Math.sqrt(seP/n).toFixed(2));
// profil gjennom grunna
const row=Math.round(1250/res); let line=''; for (let i=150;i<450;i+=15) line+= trueD[row*W+i].toFixed(0)+'/'+r.depth[row*W+i].toFixed(0)+' '; console.log(line);
