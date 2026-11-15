import { Fragment, useRef, useState } from 'react'
import type { Astronaut, Catalog, MissionPlan } from '../api'
import { kcal, num, range, words } from '../numbers'
import { Button, ConfirmButton, NumberField, Segmented, Select, Slider, TextField } from '../components/controls'
import { Portrait, hasPortrait } from '../components/Portrait'
import { Mark, StageIcon } from '../components/icons'
import { squarePhoto } from '../files'
import { type Photos, loadPhotos, photoKey, store } from '../state'
import { FactRow } from './parts'

// Everyone as a grid of tiles. Pressing the portrait or the call sign picks
// the person for the mission, as a check box would: those going are outlined
// in the accent colour and their box is ticked. Details opens their
// information under the row. The rest wait on the roster,
// which the browser keeps. A person in both is shown once, as the mission
// has them. Search narrows the grid by call sign or role.
export function CrewStep({
  catalog,
  crew,
  plan,
  roster,
  onNew,
  onSelect,
  onDeselect,
  onUpdate,
  onUpdateRoster,
  onDelete,
}: {
  catalog: Catalog
  crew: Astronaut[]
  plan: MissionPlan | null
  roster: Astronaut[]
  // Adds a new person to the list and the crew, and returns their call sign.
  onNew: () => string
  onSelect: (person: Astronaut) => void
  onDeselect: (index: number) => void
  onUpdate: (index: number, patch: Partial<Astronaut>, field: string) => void
  onUpdateRoster: (name: string, patch: Partial<Astronaut>) => void
  // Takes the person off the crew and the roster.
  onDelete: (name: string) => void
}) {
  // The call sign whose information is open.
  const [open, setOpen] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  // Photos added here. One replaces the file that ships with the app.
  const [photos, setPhotos] = useState(loadPhotos)
  const [photoProblem, setPhotoProblem] = useState<string | null>(null)
  const photoInput = useRef<HTMLInputElement>(null)
  const keepPhotos = (next: Photos) => {
    const kept = store('photos', next)
    if (kept) setPhotos(next)
    setPhotoProblem(kept ? null : 'This browser has no room left for the photo. Remove another photo first.')
  }
  const without = (name: string): Photos => {
    const { [photoKey(name)]: _, ...rest } = photos
    return rest
  }

  const people = [
    ...roster.map((person) => crew.find((member) => member.name === person.name) ?? person),
    ...crew.filter((member) => !roster.some((person) => person.name === member.name)),
  ]
  const wanted = query.trim().toLowerCase()
  const found = people.filter((person) => `${person.name} ${words(person.role)}`.toLowerCase().includes(wanted))

  return (
    <section className="card">
      <h2 className="card__title">
        <StageIcon id="crew" />
        Crew
        <button type="button" className="button card__add" onClick={() => setOpen(onNew())}>
          + Add person
        </button>
      </h2>

      <input
        type="search"
        className="input"
        aria-label="Search crew by call sign or role"
        placeholder="Search call sign or role"
        spellCheck={false}
        autoComplete="off"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {found.length === 0 && (
        <p className="note">
          Nobody matches "{query.trim()}". <button type="button" onClick={() => setQuery('')}>Show everyone</button>
        </p>
      )}

      <ul className="tiles">
        {found.map((person) => {
          const at = crew.findIndex((member) => member.name === person.name)
          const selected = at >= 0
          const isOpen = open === person.name
          const daily = selected ? plan?.crew[at]?.daily : undefined
          const photo = photos[photoKey(person.name)]
          const set = <K extends keyof Astronaut>(key: K, value: Astronaut[K]) => {
            const patch = { [key]: value } as Partial<Astronaut>
            if (selected) onUpdate(at, patch, key)
            else onUpdateRoster(person.name, patch)
            if (key !== 'name') return
            setOpen(value as string)
            // The photo follows the call sign, unless that one has a photo already.
            const to = photoKey(value as string)
            if (photo && to && !(to in photos)) keepPhotos({ ...without(person.name), [to]: photo })
          }
          return (
            // Keyed by place in the list, so retyping a call sign keeps its field.
            <Fragment key={people.indexOf(person)}>
              <li className={`tile${selected ? ' is-selected' : ''}`}>
                <button
                  type="button"
                  className="tile__pick"
                  role="checkbox"
                  aria-checked={selected}
                  title={selected ? 'Going. Click to leave behind' : 'Click to add to the crew'}
                  onClick={() => (selected ? onDeselect(at) : onSelect(person))}
                >
                  <Portrait name={person.name} photo={photo} />
                  <span className="tile__check" aria-hidden="true">
                    {selected && <Mark id="check" />}
                  </span>
                  <span className="person__name">{person.name || 'Unnamed'}</span>
                </button>
                <Button
                  variant="quiet"
                  className="tile__more"
                  aria-expanded={isOpen}
                  aria-label={`Details for ${person.name || 'unnamed'}`}
                  onClick={() => {
                    setOpen(isOpen ? null : person.name)
                    setPhotoProblem(null)
                  }}
                >
                  Details
                  <Mark id={isOpen ? 'up' : 'down'} />
                </Button>
              </li>

              {/* Spans the grid, under the row its tile is in. */}
              {isOpen && (
                <li className="item__body tile__details">
                  <TextField label="Call sign" value={person.name} maxLength={31} onChange={(v) => set('name', v)} />
                  <div className="field">
                    <span className="label">Photo</span>
                    <div className="field__buttons">
                      <Button onClick={() => photoInput.current?.click()}>{photo || hasPortrait(person.name) ? 'Change photo' : 'Add photo'}</Button>
                      {photo && (
                        <Button variant="quiet" onClick={() => keepPhotos(without(person.name))}>
                          Remove photo
                        </Button>
                      )}
                      <input
                        ref={photoInput}
                        type="file"
                        accept="image/*"
                        hidden
                        onChange={(e) => {
                          const file = e.target.files?.[0]
                          e.target.value = ''
                          if (!file) return
                          squarePhoto(file).then(
                            (url) => keepPhotos({ ...photos, [photoKey(person.name)]: url }),
                            (error: Error) => setPhotoProblem(`${error.message}. Pick a JPEG, PNG or WebP file.`),
                          )
                        }}
                      />
                    </div>
                  </div>
                  {photoProblem && (
                    <p className="note" role="alert">
                      {photoProblem}
                    </p>
                  )}
                  <Segmented label="Sex" value={person.sex} options={catalog.sexes} format={words} onChange={(v) => set('sex', v)} />
                  <Select
                    label="Role"
                    value={person.role}
                    options={catalog.roles}
                    format={words}
                    onChange={(v) => set('role', v)}
                  />
                  <NumberField
                    label="Age"
                    value={person.age}
                    min={18}
                    max={99}
                    unit="y"
                    onChange={(v) => set('age', v)}
                  />
                  <NumberField
                    label="Mass"
                    value={person.massKg}
                    min={30}
                    max={250}
                    step={0.1}
                    unit="kg"
                    onChange={(v) => set('massKg', v)}
                  />
                  <NumberField
                    label="Height"
                    value={person.heightCm}
                    min={120}
                    max={250}
                    unit="cm"
                    onChange={(v) => set('heightCm', v)}
                  />
                  <Select
                    label="Activity"
                    value={person.activity}
                    options={catalog.activities}
                    format={words}
                    onChange={(v) => set('activity', v)}
                  />
                  <Slider
                    label="Share of EVA hours"
                    value={Math.round(person.evaShare * 100)}
                    onChange={(v) => set('evaShare', v / 100)}
                    max={255}
                    sliderMax={200}
                    step={5}
                    unit="%"
                  />

                  {daily && (
                    <details className="details">
                      <summary>Needs per day inside</summary>
                      <dl className="facts">
                        <FactRow label="Food energy">{num(kcal(daily.foodEnergyMJ))} kcal</FactRow>
                        <FactRow label="Protein">{range(daily.proteinG)} g</FactRow>
                        <FactRow label="Carbohydrate">{range(daily.carbohydrateG)} g</FactRow>
                        <FactRow label="Fat">{range(daily.fatG)} g</FactRow>
                        <FactRow label="Fluid">{num(daily.fluidL, 1)} L</FactRow>
                        {daily.nutrients.map((nutrient) => (
                          <FactRow key={nutrient.id} label={nutrient.label}>
                            {nutrient.max === undefined
                              ? num(nutrient.amount, nutrient.amount % 1 === 0 ? 0 : 1)
                              : `${num(nutrient.amount)}-${num(nutrient.max)}`}{' '}
                            {nutrient.unit}
                          </FactRow>
                        ))}
                      </dl>
                    </details>
                  )}

                  <div className="actions">
                    <ConfirmButton
                      label="Delete from the list"
                      confirmLabel="Confirm delete"
                      className="button--remove"
                      onConfirm={() => {
                        setOpen(null)
                        if (photo) keepPhotos(without(person.name))
                        onDelete(person.name)
                      }}
                    />
                  </div>
                </li>
              )}
            </Fragment>
          )
        })}
      </ul>
    </section>
  )
}
