import React, { useEffect } from 'react';
import Rail from './Rail.js';
const DrawerNav = React.memo(function DrawerNav({ open, onClose }) {
    useEffect(() => {
        if (!open)
            return;
        const handler = (e) => { if (e.key === 'Escape')
            onClose(); };
        document.addEventListener('keydown', handler);
        return () => document.removeEventListener('keydown', handler);
    }, [open, onClose]);
    return (<>
      {/* Overlay */}
      <div onClick={onClose} style={{
            position: 'fixed', inset: 0, zIndex: 299,
            background: 'rgba(0,0,0,.55)',
            backdropFilter: 'blur(4px)',
            opacity: open ? 1 : 0,
            pointerEvents: open ? 'all' : 'none',
            transition: 'opacity .25s',
        }}/>
      {/* Drawer */}
      <div style={{
            position: 'fixed',
            left: 0, top: 0, bottom: 0,
            width: 272,
            zIndex: 400,
            transform: open ? 'translateX(0)' : 'translateX(-100%)',
            transition: 'transform .28s cubic-bezier(.4,0,.2,1)',
        }}>
        <Rail onClose={onClose}/>
      </div>
    </>);
});
export default DrawerNav;
