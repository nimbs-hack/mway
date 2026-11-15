import type { Catalog, MissionPlan, Planned } from '../api'
import { kcal, kwh, meters, num, range, words } from '../numbers'
import { siteLegs, totalLegs } from './legs'
import { Readout } from '../components/controls'
import { FactRow } from './parts'

// Its own chunk, so the HUD page, which shares hud-snapshot, never loads the editor.
import { EvaTime } from './EvaTime'

const SECONDS_PER_DAY = 86400

// Share of what was used that recycling gave back.
const recycled = (used: number, supplied: number): string =>
  used > 0 ? `${Math.round((1 - supplied / used) * 100)}% recycled` : ''

// Nutrient targets run from 1.1 g to 3,400 mg, so keep one decimal where there is one.
const amount = (value: number): string => value.toLocaleString('en-US', { maximumFractionDigits: 1 })

// One crew member's needs, closed until asked for.
function CrewNeeds({
  member,
  days,
  rates,
  doseLimitSv,
  doseUnknownDays,
}: {
  member: MissionPlan['crew'][number]
  days: number
  rates: Catalog['rates']
  doseLimitSv: number
  doseUnknownDays: number
}) {
  const { daily, total, taskHours } = member
  const over = member.doseSv > doseLimitSv
  return (
    <details className="crew-needs">
      <summary>
        <span className="crew-needs__name">{member.name}</span>
        <span className="crew-needs__meta">
          <span className={over ? 'is-hazard' : undefined}>{num(member.doseSv * 1000)} mSv</span> · {num(kcal(daily.foodEnergyMJ))} kcal/d
        </span>
      </summary>
      <div className="crew-needs__body">
        <div>
          <h3 className="planner__title">Whole mission, {num(days)} days, before margin</h3>
          <dl className="facts">
            <FactRow label="Food, packaged">{num(total.foodKg, 1)} kg</FactRow>
            <FactRow label="Water used">{num(total.waterUsedKg, 1)} kg</FactRow>
            <FactRow label="Water to supply after recycling">{num(total.waterSupplyKg, 1)} kg</FactRow>
            <FactRow label="Oxygen used">{num(total.oxygenUsedKg, 1)} kg</FactRow>
            <FactRow label="Oxygen to supply after recycling">{num(total.oxygenSupplyKg, 1)} kg</FactRow>
            <FactRow label="Carbon dioxide to remove">{num(total.co2Kg, 1)} kg</FactRow>
            <FactRow label="Body heat to reject, average">
              {num((total.heatMJ * 1e6) / (days * SECONDS_PER_DAY))} W
            </FactRow>
            <FactRow label="Electricity, life support and equipment">{num(kwh(total.electricityMJ))} kWh</FactRow>
            <FactRow label="EVA">{num(total.evaHours, 1)} h</FactRow>
            <FactRow label="Tasks assigned, outside">{num(taskHours.eva, 1)} h</FactRow>
            <FactRow label="Tasks assigned, inside">{num(taskHours.inside, 1)} h</FactRow>
            <FactRow label="Radiation, quiet sun">
              <span
                className={over ? 'is-hazard' : undefined}
                title={`Measured rates by phase: cruise, station, Moon or Mars surface. Habitat time uses the unshielded surface rate, so it is an upper bound. A solar particle event adds on top, up to the 250 mSv per event NASA allows.${doseUnknownDays > 0 ? ` Leaves out ${num(doseUnknownDays)} days of custom phases.` : ''}`}
              >
                {num(member.doseSv * 1000)} of {num(doseLimitSv * 1000)} mSv career
              </span>
            </FactRow>
          </dl>
        </div>
        <div>
          <h3 className="planner__title">Per day inside</h3>
          <dl className="facts">
            <FactRow label="Food energy">{num(kcal(daily.foodEnergyMJ))} kcal</FactRow>
            <FactRow label="Protein">{range(daily.proteinG)} g</FactRow>
            <FactRow label="Carbohydrate">{range(daily.carbohydrateG)} g</FactRow>
            <FactRow label="Fat">{range(daily.fatG)} g</FactRow>
            <FactRow label="Fluid">{num(daily.fluidL, 2)} L</FactRow>
          </dl>
          <p className="note">
            Each EVA hour adds {rates.evaFoodKcalPerHour} kcal and {rates.evaDrinkKgPerHour} kg of drinking water.
          </p>
        </div>
        <div>
          <h3 className="planner__title">Nutrients per day</h3>
          <dl className="facts">
            {daily.nutrients.map((nutrient) => (
              <FactRow key={nutrient.id} label={nutrient.label}>
                {amount(nutrient.amount)}
                {nutrient.max !== undefined && `-${amount(nutrient.max)}`} {nutrient.unit}
              </FactRow>
            ))}
          </dl>
        </div>
      </div>
    </details>
  )
}

export function ReviewStep({
  catalog,
  planned,
  stale,
  onSave,
  onExportJson,
  selectedSite,
  onSite,
  missionId,
}: {
  catalog: Catalog
  planned: Planned
  // The numbers are from the last mission the planner accepted.
  stale: boolean
  // Null while the mission cannot be saved.
  onSave: (() => void) | null
  onExportJson: () => void
  // The site shown as selected on the globe beside this page.
  selectedSite: number
  onSite: (index: number) => void
  // Key of the mission's EVA plan in browser storage, as the Sites page uses it.
  missionId: string
}) {
  const { mission, plan, cautions: warnings } = planned
  const legs = siteLegs(mission.sites)
  const { rates } = catalog
  const { total, provision } = plan
  const seconds = plan.days * SECONDS_PER_DAY

  return (
    <>
      <div className="step">
        {warnings.length > 0 && (
          <ul className="cautions" aria-label="Cautions">
            {warnings.map((warning) => (
              <li key={warning}>
                <b>Caution</b>
                {warning}
              </li>
            ))}
          </ul>
        )}

        <EvaTime missionId={missionId} />

        <section>
          <h2 className="planner__title">To supply, {plan.marginPercent}% margin included</h2>
          <div className="review__grid">
            <Readout
              label="Food, packaged"
              value={`${num(provision.foodKg)} kg`}
              sub={`${num(kcal(provision.foodEnergyMJ) / 1e6, 2)} Gcal`}
            />
            <Readout
              label="Water"
              value={`${num(provision.waterSupplyKg)} kg`}
              sub={recycled(total.waterUsedKg, total.waterSupplyKg)}
            />
            <Readout
              label="Oxygen"
              value={`${num(provision.oxygenSupplyKg)} kg`}
              sub={recycled(total.oxygenUsedKg, total.oxygenSupplyKg)}
            />
            <Readout
              label="Electricity"
              value={`${num(kwh(provision.electricityMJ))} kWh`}
              sub={`${num((total.electricityMJ * 1000) / seconds, 2)} kW average`}
            />
          </div>
        </section>

        <section>
          <h2 className="planner__title">Loads on the vehicle</h2>
          <dl className="facts">
            <dt>Carbon dioxide to remove</dt>
            <dd>{num(total.co2Kg)} kg</dd>
            <dt>Body heat to reject, average</dt>
            <dd>{num((total.heatMJ * 1e6) / seconds)} W</dd>
            <dt>EVA, all crew</dt>
            <dd>{num(total.evaHours)} h</dd>
          </dl>
        </section>

        <section>
          <h2 className="planner__title">To supply by phase, before margin</h2>
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Phase</th>
                <th scope="col">Food kg</th>
                <th scope="col">Water kg</th>
                <th scope="col">Oxygen kg</th>
              </tr>
            </thead>
            <tbody>
              {plan.phases.map((phase, i) => (
                <tr key={i}>
                  <th scope="row">
                    {i + 1} {words(phase.kind)}
                  </th>
                  <td>{num(phase.total.foodKg)}</td>
                  <td>{num(phase.total.waterSupplyKg)}</td>
                  <td>{num(phase.total.oxygenSupplyKg)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section>
          <h2 className="planner__title">Sites, with the distance from the one before</h2>
          {mission.sites.length === 0 ? (
            <p className="note">No sites. Add points on the Sites page.</p>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Site</th>
                  <th scope="col">Distance</th>
                  <th scope="col">Tasks</th>
                  <th scope="col">Hours</th>
                </tr>
              </thead>
              <tbody>
                {mission.sites.map((site, i) => {
                  const tasks = mission.tasks.filter((task) => task.site === i)
                  const leg = legs[i]
                  return (
                    <tr key={i}>
                      <th scope="row">
                        <button
                          type="button"
                          aria-pressed={i === selectedSite}
                          title="Show on the globe"
                          onClick={() => onSite(i)}
                        >
                          {i + 1} {site.name}
                        </button>
                      </th>
                      <td>{leg === null || leg === undefined ? '' : meters(leg)}</td>
                      <td>{num(tasks.length)}</td>
                      <td>
                        {num(
                          tasks.reduce((sum, task) => sum + task.hours, 0),
                          1,
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr>
                  <th scope="row">Through all sites</th>
                  <td>{meters(totalLegs(legs))}</td>
                  <td>{num(mission.tasks.length)}</td>
                  <td>
                    {num(
                      mission.tasks.reduce((sum, task) => sum + task.hours, 0),
                      1,
                    )}
                  </td>
                </tr>
              </tfoot>
            </table>
          )}
        </section>

        <section>
          <h2 className="planner__title">By crew member</h2>
          <div>
            {plan.crew.map((member, i) => (
              <CrewNeeds
                key={i}
                member={member}
                days={plan.days}
                rates={rates}
                doseLimitSv={plan.doseLimitSv}
                doseUnknownDays={plan.doseUnknownDays}
              />
            ))}
          </div>
          <p className="note">
            Electricity here is each person's share of life support and crew equipment. Vehicle base power is in the
            mission total only.
          </p>
        </section>

        <section>
          <h2 className="planner__title">Mission file</h2>
          <dl className="facts">
            <dt>Size</dt>
            <dd>{num(planned.fileBytes)} bytes</dd>
          </dl>
        </section>

        <details className="details">
          <summary>How these numbers are worked out</summary>
          <dl className="facts">
            <dt>Food energy per person-day</dt>
            <dd>DRI equation</dd>
            <dt>Added per EVA hour</dt>
            <dd>{rates.evaFoodKcalPerHour} kcal</dd>
            <dt>Food, packaged, per 1,000 kcal</dt>
            <dd>{num(rates.foodKgPer1000Kcal ?? NaN, 2)} kg</dd>
            <dt>Oxygen breathed per 1,000 kcal</dt>
            <dd>{num(rates.oxygenKgPer1000Kcal ?? NaN, 3)} kg</dd>
            <dt>Carbon dioxide per 1,000 kcal</dt>
            <dd>{num(rates.co2KgPer1000Kcal ?? NaN, 3)} kg</dd>
            <dt>Drinking and food water per person-day</dt>
            <dd>{rates.potableWaterKgPerDay} kg or more</dd>
            <dt>Drinking water per EVA hour</dt>
            <dd>{rates.evaDrinkKgPerHour} kg</dd>
            <dt>Suit cooling water lost per EVA hour</dt>
            <dd>{rates.evaCoolingWaterKgPerHour} kg</dd>
            <dt>Suit oxygen lost per EVA hour</dt>
            <dd>{rates.evaOxygenLossKgPerHour} kg</dd>
          </dl>
          <p className="note">
            Rates are from NASA's life support baseline document, NASA-STD-3001 and the 2020 exploration nutrition
            requirements. Recycling, EVA hours and power are the phase settings in step 3, and you can change every one
            of them. The planner's README lists each source and what is assumed.
          </p>
        </details>
      </div>

      <footer className="plan__dock">
        <div className={`plan__verdict${stale || warnings.length > 0 ? ' is-caution' : ' is-go'}`} role="status">
          <strong>{stale ? 'Stale' : warnings.length > 0 ? 'Caution' : 'Ready'}</strong>
          <span>
            {stale
              ? 'From the last mission the planner accepted'
              : warnings.length > 0
                ? `${warnings.length} to look at before saving`
                : `${num(planned.fileBytes)} byte mission file`}
          </span>
        </div>
        <div className="plan__actions">
          <button type="button" className="plan__button" disabled={!onSave} onClick={onExportJson}>
            Export JSON
          </button>
          <button
            type="button"
            className="plan__button plan__button--primary"
            disabled={!onSave}
            onClick={onSave ?? undefined}
            title="Ctrl+S"
          >
            Save mission file
          </button>
        </div>
      </footer>
    </>
  )
}
