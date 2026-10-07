import type {CSSProperties} from 'react';
// The restored AI popup is the visual source of truth for related finance sheets.
export const aiPopupStyle:CSSProperties={
 width:'100%',maxWidth:'var(--app-max-width, 440px)',maxHeight:'92dvh',
 background:'#FFFFFF',color:'#1E1A3C',borderRadius:'28px 28px 0 0',
 padding:'16px 20px max(12px, env(safe-area-inset-bottom, 0px))',
 boxShadow:'0 -10px 40px rgba(0,0,0,0.15)',position:'relative',fontFamily:'inherit',
};
export const aiPopupTransition={type:'spring',damping:26,stiffness:220} as const;
