import { useState, useRef, useEffect, type ReactNode } from 'react';
import { motion, useDragControls, useReducedMotion, type HTMLMotionProps } from 'motion/react';

type Props = Omit<HTMLMotionProps<'div'>,'children'> & { children?:ReactNode; footer?:ReactNode; scrollBody?:boolean; onDismiss: () => void; locked?: boolean };
// Drag starts only on the handle; forms and content keep native scrolling.
export default function SwipeSheet({onDismiss,locked=false,children,footer,scrollBody=false,style,...props}:Props) {
  const sheetRef=useRef<HTMLDivElement>(null);
  const dragged=useRef(false);
  useEffect(()=>{const key=(e:KeyboardEvent)=>{const sheets=document.querySelectorAll('[data-finance-sheet]');if(e.key==='Escape'&&!locked&&sheets[sheets.length-1]===sheetRef.current){e.preventDefault();onDismiss();}};window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);},[locked,onDismiss]);
  const [dragging,setDragging]=useState(false);
  const controls=useDragControls();
  const reduced=useReducedMotion();
  const [expanded,setExpanded]=useState(false);
  const [availableHeight,setAvailableHeight]=useState<number|null>(null);
  const [keyboardInset,setKeyboardInset]=useState(0);
  useEffect(()=>{
    const viewport=window.visualViewport;
    const update=()=>{
      setAvailableHeight(Math.max(120,(viewport?.height||window.innerHeight)-12));
      setKeyboardInset(viewport?Math.max(0,window.innerHeight-viewport.height-viewport.offsetTop):0);
    };
    update();viewport?.addEventListener('scroll',update);viewport?.addEventListener('resize',update);window.addEventListener('resize',update);
    return()=>{viewport?.removeEventListener('scroll',update);viewport?.removeEventListener('resize',update);window.removeEventListener('resize',update);};
  },[]);

  return <motion.div {...props} ref={sheetRef} data-finance-sheet role="dialog" aria-modal="true" drag={locked?false:'y'} dragControls={controls} dragListener={false}
    dragConstraints={{top:0,bottom:0}} dragElastic={{top:0.12,bottom:0.65}} dragSnapToOrigin
    onDragStart={()=>{dragged.current=true;setDragging(true);}}
    onDragEnd={(_,info)=>{
      setDragging(false);
      if(locked)return;
      if(info.offset.y>100 || (info.offset.y>25 && info.velocity.y>600))onDismiss();
      else if(info.offset.y < -35)setExpanded(true);
    }}
    transition={reduced?{duration:0}:props.transition}
    style={{...style,...(keyboardInset?{marginBottom:keyboardInset}:{}),...(dragging?{userSelect:'none',cursor:'grabbing'} as const:{}),...(scrollBody?{display:'flex',flexDirection:'column',overflow:'hidden'} as const:{}),overscrollBehavior:'contain',...(expanded?{height:'90dvh',maxHeight:'90dvh'}:{}),...(availableHeight?{maxHeight:`min(${expanded?'90dvh':typeof style?.maxHeight==='number'?style.maxHeight+'px':style?.maxHeight||'90dvh'}, ${availableHeight}px)`}:{})}}>
    <button type="button" aria-label="Oynani kengaytirish" disabled={locked}
      onPointerDown={e=>{dragged.current=false;if(!locked)controls.start(e);}}
      onClick={()=>{if(!dragged.current)setExpanded(v=>!v);}}
      style={{flexShrink:0,display:'block',width:72,height:28,padding:0,margin:'-8px auto 4px',border:0,background:'transparent',touchAction:'none',userSelect:'none',WebkitUserSelect:'none',cursor:locked?'default':dragging?'grabbing':'grab'}}>
      <span style={{display:'block',width:40,height:4,margin:'auto',borderRadius:4,background:'#C4B5FD'}} />
    </button>
    {scrollBody?<div style={{minHeight:0,overflowY:'auto',overscrollBehavior:'contain',flex:'1 1 auto'}}>{children}</div>:children}
    {footer && <div style={{flexShrink:0,background:'#fff',paddingTop:8,borderTop:'1px solid #F0ECF8'}}>{footer}</div>}
  </motion.div>;
}
