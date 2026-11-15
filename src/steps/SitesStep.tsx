import { formatLatLon } from '../format.js'
import type { Site } from '../api'
import type { Draft, Selection } from '../state'
import { Button, NumberField, TextField } from '../components/controls'
import { isOpen, Row } from './parts'

// The mission's places: a name, a short description and coordinates each.
// What happens there, and in what order, is set on the Plan tab.
export function SitesStep({
  draft,
  selection,
  onSelect,
  placing,
  onPlacing,
  onUpdateSite,
  onRemoveSite,
}: {
  draft: Draft
  selection: Selection
  onSelect: (selection: Selection) => void
  placing: boolean
  onPlacing: (placing: boolean) => void
  onUpdateSite: (index: number, patch: Partial<Site>, field: string) => void
  onRemoveSite: (index: number) => void
}) {
  const stops = draft.route ?? []
  return (
    <>
      <Button aria-pressed={placing} onClick={() => onPlacing(!placing)}>
        {placing ? 'Done. Each click on the map adds a site' : 'Add sites'}
      </Button>
      {draft.sites.length === 0 && !placing && <p className="note">No sites yet. Press Add sites and click the map once for each.</p>}

      <ol className="items">
        {draft.sites.map((site, i) => {
          const visits = stops.filter((stop) => stop === i).length
          const tasks = draft.tasks.filter((task) => task.site === i).length
          const validPosition = !Number.isNaN(site.lat) && !Number.isNaN(site.lon)
          const gone = [visits && `${visits} ${visits === 1 ? 'stop' : 'stops'}`, tasks && `${tasks} ${tasks === 1 ? 'task' : 'tasks'}`].filter(Boolean)
          return (
            <Row
              key={i}
              index={i + 1}
              name={site.name || 'Unnamed'}
              meta={!stops.length ? '' : visits ? `In the plan ${visits === 1 ? 'once' : `${visits} times`}` : 'Not in the plan'}
              open={isOpen(selection, 'site', i)}
              onToggle={() => onSelect(isOpen(selection, 'site', i) ? null : { list: 'site', index: i })}
            >
              <TextField label="Name" value={site.name} maxLength={31} onChange={(name) => onUpdateSite(i, { name }, 'name')} />
              <TextField
                label="Description"
                value={site.description ?? ''}
                maxLength={160}
                lines={2}
                placeholder="What is here and why the crew goes"
                onChange={(description) => onUpdateSite(i, { description }, 'description')}
              />
              <div className="fields fields--2">
                <NumberField label="Latitude, north +" value={site.lat} min={-90} max={90} step={0.0001} unit="°" onChange={(lat) => onUpdateSite(i, { lat }, 'lat')} />
                <NumberField label="Longitude, east +" value={site.lon} min={-180} max={180} step={0.0001} unit="°" onChange={(lon) => onUpdateSite(i, { lon }, 'lon')} />
              </div>
              {validPosition && <p className="note">{formatLatLon(site.lat, site.lon)}, planetocentric.</p>}
              <div className="actions">
                <Button className="button--remove" onClick={() => onRemoveSite(i)}>
                  Remove site{gone.length ? ` with its ${gone.join(' and ')}` : ''}
                </Button>
              </div>
            </Row>
          )
        })}
      </ol>
    </>
  )
}
