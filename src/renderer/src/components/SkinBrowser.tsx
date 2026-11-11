import { Check } from 'lucide-react'
import type { Skin } from '../../../shared/types'
import { skins } from '../skins'

export function SkinBrowser({
  selected,
  onSelect,
}: {
  selected: Skin
  onSelect(skin: Skin): void
}) {
  return (
    <div className="skin-grid" role="group" aria-label="Available skins">
      {skins.map((skin) => (
        <button
          key={skin.id}
          type="button"
          className={`skin-card${selected === skin.id ? ' chosen' : ''}`}
          aria-pressed={selected === skin.id}
          aria-label={`Preview ${skin.name}`}
          onClick={() => onSelect(skin.id)}
        >
          <div
            className={`skin-mini mini-${skin.id}`}
            aria-hidden="true"
            style={
              {
                '--mini-accent': skin.colors[0],
                '--mini-bg': skin.colors[1],
                '--mini-ink': skin.colors[2],
              } as React.CSSProperties
            }
          >
            <div className="mini-header">
              <i />
              <b>Margin PDF</b>
              <span />
            </div>
            <div className="mini-tabs">
              <i />
              <i />
              <i />
            </div>
            <div className="mini-tools">
              <i />
              <i />
              <i />
            </div>
            <div className="mini-index">
              <i />
              <i />
              <i />
              <i />
            </div>
            <div className="mini-paper">
              <b />
              {Array.from({ length: 7 }, (_, i) => (
                <i key={i} />
              ))}
            </div>
          </div>
          <div className="skin-card-copy">
            <span className="skin-card-heading">
              <strong>{skin.name}</strong>
              {selected === skin.id && <Check size={15} />}
            </span>
            <span>{skin.caption}</span>
            <small>{skin.typography}</small>
          </div>
        </button>
      ))}
    </div>
  )
}
