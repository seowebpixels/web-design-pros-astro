for(const root of document.querySelectorAll<HTMLElement>('[data-review-carousel]')){
 const track=root.querySelector<HTMLOListElement>('[data-reviews-track]')!;
 const cards=Array.from(track.querySelectorAll<HTMLElement>('[data-review-card]'));
 const controls=root.querySelector<HTMLElement>('[data-review-controls]')!;
 const prev=root.querySelector<HTMLButtonElement>('[data-review-prev]')!;
 const next=root.querySelector<HTMLButtonElement>('[data-review-next]')!;
 const position=root.querySelector<HTMLElement>('[data-review-position]')!;
 let frame=0;
 const metrics=()=>{
  const width=cards[0]?.getBoundingClientRect().width??0;
  const gap=parseFloat(getComputedStyle(track).columnGap)||0;
  return {width,step:width+gap};
 };
 function update(){
  const {step}=metrics();if(!step)return;
  const max=Math.max(0,track.scrollWidth-track.clientWidth);
  const visible=Math.max(1,Math.min(cards.length,Math.round((track.clientWidth+(parseFloat(getComputedStyle(track).columnGap)||0))/step)));
  const first=Math.max(0,Math.min(cards.length-visible,Math.round(track.scrollLeft/step)));
  prev.disabled=track.scrollLeft<=2;next.disabled=track.scrollLeft>=max-2;
  position.textContent=`Reviews ${first+1}–${Math.min(cards.length,first+visible)} of ${cards.length}`;
 }
 function move(direction:number){
  const {step}=metrics(),max=Math.max(0,track.scrollWidth-track.clientWidth);
  const target=Math.max(0,Math.min(max,Math.round(track.scrollLeft/step)*step+direction*step));
  track.scrollTo({left:target,behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});
 }
 prev.addEventListener('click',()=>move(-1));next.addEventListener('click',()=>move(1));
 track.addEventListener('keydown',event=>{
  if(event.target!==track)return;
  if(event.key==='ArrowLeft'||event.key==='ArrowRight'){event.preventDefault();move(event.key==='ArrowLeft'?-1:1);}
  else if(event.key==='Home'||event.key==='End'){event.preventDefault();track.scrollTo({left:event.key==='Home'?0:track.scrollWidth,behavior:'instant'});}
 });
 track.addEventListener('scroll',()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(update);},{passive:true});
 new ResizeObserver(update).observe(track);
 // ResizeObserver performs the first measurement after layout, avoiding
 // a synchronous layout read immediately after revealing the controls.
 controls.hidden=false;
}
