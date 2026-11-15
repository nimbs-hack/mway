import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { slopeLevel } from '../data/route-profile'
import { formatElevation, formatLatLon } from '../format'
import { MIL2525C_BY_ID, MIL2525C_SYMBOLS, MIL2525C_THEMES } from '../data/mil2525c'
import { formatPressure, formatTemp } from '../data/weather'
import { COARSE_DETAIL, detailLabel } from '../data/terrain-detail'
import { GROUND_NAME } from '../data/ground'
import { formatDistance, formatSlope } from './RouteProfile'
import './point-menu.css'

// Gap between the pointer and the menu.
const GAP = 4

/**
 * Right-click menu for one spot on the map, after Google Maps: coordinates,
 * elevation and slope, estimated weather, plan actions and
 * map symbols.
 * Opened on a placed marker, it edits that marker instead. Opens at
 * `probe.screen`, flipped to stay inside the map. Esc or a click outside
 * closes it.
 */
export default function PointReadout({
  probe, limit, actions = [], weather, marker,
  onAddMarker, onUpdateMarker, onRemoveMarker, onClose,
}) {
  const menu = useRef(null)
  const [place, setPlace] = useState(null)
  const [picking, setPicking] = useState(false)
  const [theme, setTheme] = useState(MIL2525C_THEMES[0].id)
  const [copied, setCopied] = useState(false)
  const [lat, lon] = probe.point
  const where = formatLatLon(lat, lon)

  // Flip left or up when the menu would cross the map edge.
  useLayoutEffect(() => {
    const el = menu.current
    const box = el?.offsetParent?.getBoundingClientRect()
    if (!el || !box) return
    const { x, y } = probe.screen
    const left = x + GAP + el.offsetWidth > box.width ? Math.max(GAP, x - GAP - el.offsetWidth) : x + GAP
    const top = y + GAP + el.offsetHeight > box.height ? Math.max(GAP, y - GAP - el.offsetHeight) : y + GAP
    setPlace({ left, top })
  }, [probe.screen, probe.status, picking, theme])

  useEffect(() => {
    const close = (event) => {
      if (event.type === 'keydown' ? event.key === 'Escape' : !menu.current?.contains(event.target)) onClose()
    }
    // Wait a frame so the click that opened the menu doesn't close it.
    const timer = setTimeout(() => {
      document.addEventListener('pointerdown', close)
      document.addEventListener('keydown', close)
    })
    return () => {
      clearTimeout(timer)
      document.removeEventListener('pointerdown', close)
      document.removeEventListener('keydown', close)
    }
  }, [onClose])

  useEffect(() => {
    menu.current?.querySelector('button')?.focus()
  }, [])

  const copy = () => {
    navigator.clipboard?.writeText(where.replace(/\s+/g, ' ')).then(() => setCopied(true), () => {})
  }

  return (
    <div
      ref={menu}
      className="pointmenu"
      role="menu"
      aria-label={`Point ${where}`}
      style={place ?? { left: probe.screen.x + GAP, top: probe.screen.y + GAP, visibility: 'hidden' }}
    >
      <button type="button" role="menuitem" className="pointmenu__where" onClick={copy} title="Copy coordinates">
        {copied ? 'Copied' : where}
      </button>
      <p className="pointmenu__terrain" role="status">
        {probe.status === 'loading' && 'Sampling…'}
        {probe.status === 'error' && 'No terrain here yet'}
        {probe.status === 'ready' && (
          <>
            <span>{probe.elevation === null ? '—' : formatElevation(probe.elevation)}</span>
            <span className={`is-${slopeLevel(probe.slope, limit)}`}>{formatSlope(probe.slope)}</span>
            {probe.detail != null && (
              <span
                className={probe.detail > COARSE_DETAIL ? 'is-caution' : ''}
                title={probe.detail > COARSE_DETAIL ? 'Coarse terrain hides boulders and small scarps. Slope here is a smoothed lower bound.' : 'Ground spacing of the elevation model here'}
              >
                {detailLabel(probe.detail)} terrain
              </span>
            )}
            {GROUND_NAME[probe.ground] && (
              <span className="is-caution" title="Estimated from shadows in the HiRISE image here. Rocks under about 1 m do not show.">
                {GROUND_NAME[probe.ground]}
              </span>
            )}
          </>
        )}
      </p>
      {weather?.report?.latest && (
        <p
          className="pointmenu__fact"
          title={`${weather.report.rover} ${weather.report.instrument}, sol ${weather.report.latest.sol} (${weather.report.latest.date}), ${formatDistance(weather.distance)} away. Pressure scaled to this elevation with a 10.8 km scale height.`}
        >
          <span>Air</span> {formatTemp(weather.report.latest.airMinK)} to {formatTemp(weather.report.latest.airMaxK)}
          {weather.estimate != null && <> · ≈ {formatPressure(weather.estimate)}</>}
        </p>
      )}

      {marker && (
        <div className="pointmenu__group pointmenu__marker">
          <label className="pointmenu__name">
            <input type="text" aria-label="Marker name" value={marker.label} maxLength={40} onChange={(event) => onUpdateMarker({ label: event.target.value })} />
          </label>
          <p className="pointmenu__sidc" title="MIL-STD-2525C symbol identification code">
            {MIL2525C_BY_ID[marker.symbol]?.name} · {MIL2525C_BY_ID[marker.symbol]?.sidc}
          </p>
          <button type="button" role="menuitem" aria-expanded={picking} onClick={() => setPicking(!picking)}>Change symbol</button>
          <button type="button" role="menuitem" onClick={onRemoveMarker}>Delete marker</button>
        </div>
      )}

      {!marker && actions.length > 0 && (
        <div className="pointmenu__group">
          {actions.map((action) => (
            <button key={action.label} type="button" role="menuitem" onClick={action.run}>{action.label}</button>
          ))}
        </div>
      )}

      <div className="pointmenu__group">
        {!marker && (
          <button type="button" role="menuitem" aria-expanded={picking} onClick={() => setPicking(!picking)}>Add symbol</button>
        )}
        {picking && (
          <div className="pointmenu__picker">
            <div className="pointmenu__themes" role="tablist" aria-label="Symbol groups">
              {MIL2525C_THEMES.map((t) => (
                <button key={t.id} type="button" role="tab" aria-selected={theme === t.id} title={t.label} onClick={() => setTheme(t.id)}>{t.shortLabel}</button>
              ))}
            </div>
            <div className="pointmenu__symbols">
              {MIL2525C_SYMBOLS.filter((symbol) => symbol.theme === theme).map((symbol) => (
                <button
                  key={symbol.id}
                  type="button"
                  aria-label={symbol.name}
                  title={`${symbol.name} · ${symbol.sidc}`}
                  aria-pressed={marker?.symbol === symbol.id}
                  onClick={() => {
                    if (marker) {
                      onUpdateMarker({ symbol: symbol.id })
                      setPicking(false)
                    } else onAddMarker(symbol.id)
                  }}
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true" dangerouslySetInnerHTML={{ __html: symbol.svgInner }} />
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

    </div>
  )
}
