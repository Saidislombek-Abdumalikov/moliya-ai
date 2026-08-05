interface BankCardProps {
  id: string;
  bank: string;
  number: string;
  name: string;
  brand: string;
  balance: number;
  currency: string;
  onEdit?: () => void;
  onDelete?: () => void;
  editLabel?: string;
  deleteLabel?: string;
}

export default function BankCard({ bank, number, name, brand, balance, currency, onEdit, onDelete, editLabel = 'Tahrirlash', deleteLabel = "O'chirish" }: BankCardProps) {
  const getBrandColors = () => {
    switch(brand) {
      case 'uzcard': return 'linear-gradient(135deg, #1A2980 0%, #26D0CE 100%)';
      case 'humo': return 'linear-gradient(135deg, #F2994A 0%, #F2C94C 100%)';
      case 'visa': return 'linear-gradient(135deg, #4A00E0 0%, #8E2DE2 100%)';
      case 'mastercard': return 'linear-gradient(135deg, #FF416C 0%, #FF4B2B 100%)';
      default: return 'linear-gradient(135deg, #232526 0%, #414345 100%)';
    }
  }

  function fmtFull(n: number) {
    return n.toLocaleString('en-US').replace(/,/g, ' ')
  }

  return (
    <div style={{
      padding: '16px 20px',
      background: getBrandColors(),
      borderRadius: 18,
      color: 'white',
      boxShadow: '0 8px 16px rgba(0,0,0,0.12), 0 2px 4px rgba(0,0,0,0.08)',
      position: 'relative',
      overflow: 'hidden'
    }}>
      {/* Glossy overlay */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
        background: 'linear-gradient(180deg, rgba(255,255,255,0.15) 0%, rgba(255,255,255,0) 100%)',
        pointerEvents: 'none'
      }} />
      <div style={{ position: 'relative', zIndex: 1 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <p style={{ fontSize: 15, fontWeight: 700, letterSpacing: 0.5, textShadow: '0 1px 2px rgba(0,0,0,0.2)' }}>{bank}</p>
          <p style={{ fontSize: 13, fontWeight: 800, opacity: 0.95, fontStyle: 'italic', textShadow: '0 1px 2px rgba(0,0,0,0.2)' }}>{name?.toUpperCase()}</p>
        </div>
        <p style={{ fontSize: 20, letterSpacing: 2, marginBottom: 20, fontFamily: 'monospace', textShadow: '0 2px 4px rgba(0,0,0,0.3)' }}>
          {number.replace(/\D/g, '').replace(/(.{4})/g, '$1 ').trim()}
        </p>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
          <div>
            <p style={{ fontSize: 9, opacity: 0.85, marginBottom: 3, textTransform: 'uppercase', letterSpacing: 0.5 }}>Balans</p>
            <p style={{ fontSize: 16, fontWeight: 700, textShadow: '0 1px 2px rgba(0,0,0,0.2)' }}>{fmtFull(balance)} <span style={{ fontSize: 12, fontWeight: 500, opacity: 0.9 }}>{currency}</span></p>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            {onEdit && (
              <button 
                onClick={onEdit}
                style={{ background: 'rgba(255,255,255,0.25)', border: 'none', padding: '5px 10px', borderRadius: 8, color: 'white', fontSize: 11, fontWeight: 600, cursor: 'pointer', backdropFilter: 'blur(8px)', transition: 'background 0.2s' }}
              >
                {editLabel}
              </button>
            )}
            {onDelete && (
              <button 
                onClick={onDelete}
                style={{ background: 'rgba(239, 68, 68, 0.8)', border: 'none', padding: '5px 10px', borderRadius: 8, color: 'white', fontSize: 11, fontWeight: 600, cursor: 'pointer', backdropFilter: 'blur(8px)', transition: 'background 0.2s' }}
              >
                {deleteLabel}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
