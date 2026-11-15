import { Fragment, useState } from 'react'
import { tileFor, tileUrl } from '../data/raster-sample'
import './layer-switcher.css'

// Thumbnails show each layer over Gale crater, where its contrast reads well.
// Planetocentric latitude, east longitude -180 to 180.
const THUMB_AT = [-4.6, 137.4]
const THUMB_LEVEL = 4

function thumb(layer) {
  const { x, y } = tileFor(THUMB_AT, THUMB_LEVEL, 256)
  return tileUrl(layer, THUMB_LEVEL, x, y)
}

function Thumb({ layer }) {
  const colors = layer.legend.colors.length ? layer.legend.colors : ['#000000', '#ffffff']
  return (
    <span className="switcher__thumb" style={{ background: `linear-gradient(135deg, ${colors.join(', ')})` }}>
      <img src={thumb(layer)} alt="" loading="lazy" onError={(event) => { event.currentTarget.hidden = true }} />
    </span>
  )
}

/**
 * Layer picker in the bottom left of the map, after Google Maps: one tile
 * that opens a row of layer tiles on hover or click. A tile toggles its
 * layer. Failed layers offer a retry beside their tile.
 */
export default function LayerSwitcher({ layers, overlays, onToggle, statuses, onRetry }) {
  const [open, setOpen] = useState(false)
  const active = layers.filter((layer) => overlays[layer.id]?.on)
  const cover = active.at(-1) ?? layers[0]

  return (
    <div
      className={`switcher${open ? ' is-open' : ''}`}
      onPointerEnter={(event) => { if (event.pointerType === 'mouse') setOpen(true) }}
      onPointerLeave={(event) => { if (event.pointerType === 'mouse') setOpen(false) }}
      onFocus={() => setOpen(true)}
      onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false) }}
    >
      <button type="button" className="switcher__main" aria-expanded={open} aria-controls="switcher-row" onClick={() => setOpen(!open)}>
        <Thumb layer={cover} />
        <span className="switcher__label">Layers{active.length ? ` · ${active.length}` : ''}</span>
      </button>
      <div className="switcher__row" id="switcher-row" hidden={!open}>
        {layers.map((layer) => (
          <Fragment key={layer.id}>
            <button type="button" className="switcher__tile" aria-pressed={Boolean(overlays[layer.id]?.on)} onClick={() => onToggle(layer.id)} title={layer.name}>
              <Thumb layer={layer} />
              <span>{layer.short}</span>
            </button>
            {overlays[layer.id]?.on && statuses[layer.id] === 'error' && (
              <button type="button" className="switcher__retry" onClick={() => onRetry(layer.id)}>
                {layer.short} imagery missing. Retry
              </button>
            )}
          </Fragment>
        ))}
      </div>
    </div>
  )
}
