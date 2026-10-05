import { useState, useRef, type ReactNode } from 'react';
import { motion, useDragControls, useReducedMotion, type HTMLMotionProps } from 'motion/react';

type Props = Omit<HTMLMotionProps<'div'>,'children'> & { children?:ReactNode; onDismiss: () => void; locked?: boolean };
// Drag starts only on the handle; forms and content keep native scrolling.
export default function SwipeSheet({onDismiss,locked=false,children,style,...props}:Props) {
  const dragged=useRef(false);
  const controls=useDragControls();
  const reduced=useReducedMotion();
  const [expanded,setExpanded]=useState(false);
  return <motion.div {...props} drag={locked?false:'y'} dragControls={controls} dragListener={false}
    dragConstraints={{top:0,bottom:0}} dragElastic={{top:0.12,bottom:0.65}} dragSnapToOrigin
    onDragStart={()=>{dragged.current=true;}}
    onDragEnd={(_,info)=>{
      if(locked)return;
      if(info.offset.y>100 || (info.offset.y>25 && info.velocity.y>600))onDismiss();
      else if(info.offset.y < -35)setExpanded(true);
    }}
    transition={reduced?{duration:0}:props.transition}
    style={{...style,overscrollBehavior:'contain',...(expanded?{height:'90dvh',maxHeight:'90dvh'}:{})}}>
    <button type="button" aria-label="Oynani kengaytirish" disabled={locked}
      onPointerDown={e=>{dragged.current=false;if(!locked)controls.start(e);}}
      onClick={()=>{if(!dragged.current)setExpanded(v=>!v);}}
      style={{display:'block',width:72,height:28,padding:0,margin:'-8px auto 4px',border:0,background:'transparent',touchAction:'none',cursor:locked?'default':'grab'}}>
      <span style={{display:'block',width:40,height:4,margin:'auto',borderRadius:4,background:'#C4B5FD'}} />
    </button>
    {children}
  </motion.div>;
}
