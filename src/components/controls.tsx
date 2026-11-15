import { type ButtonHTMLAttributes, type CSSProperties, type ReactNode, useId, useState } from 'react'

// A number field reports NaN while it is empty. The planner then says what
// is missing instead of the field snapping back under the cursor.
const shown = (value: number): number | '' => (Number.isNaN(value) ? '' : value)

export function Button({
  variant = 'secondary',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'quiet' }) {
  return <button type="button" className={`button button--${variant} ${className}`} {...props} />
}

// For actions that undo cannot bring back. The first press arms it and the
// label changes to say so; the second press does it. [NASA-STD-3001 V2 10080]
export function ConfirmButton({
  label,
  confirmLabel,
  onConfirm,
  className = '',
  ...props
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onClick'> & {
  label: string
  confirmLabel: string
  onConfirm: () => void
}) {
  const [armed, setArmed] = useState(false)
  return (
    <Button
      variant="quiet"
      className={`${className}${armed ? ' is-armed' : ''}`}
      onBlur={() => setArmed(false)}
      onClick={() => {
        if (armed) onConfirm()
        setArmed(!armed)
      }}
      {...props}
    >
      {armed ? confirmLabel : label}
    </Button>
  )
}

export function TextField({
  label,
  value,
  onChange,
  maxLength,
  placeholder,
  lines,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  maxLength?: number
  placeholder?: string
  // More than one line of free text, such as a note.
  lines?: number
}) {
  const id = useId()
  const shared = { id, value, maxLength, placeholder, onChange: (e: { target: { value: string } }) => onChange(e.target.value) }
  return (
    <div className="field">
      <label className="label" htmlFor={id}>
        {label}
      </label>
      {lines ? (
        <textarea {...shared} className="input input--lines" rows={lines} />
      ) : (
        <input {...shared} className="input" spellCheck={false} autoComplete="off" />
      )}
    </div>
  )
}

export function NumberField({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  unit,
}: {
  label: string
  value: number
  onChange: (value: number) => void
  min: number
  max: number
  step?: number
  unit?: string
}) {
  const id = useId()
  return (
    <div className="field">
      <label className="label" htmlFor={id}>
        {label}
      </label>
      <div className="input input--number">
        <input
          id={id}
          type="number"
          inputMode="decimal"
          value={shown(value)}
          min={min}
          max={max}
          step={step}
          onChange={(e) => onChange(e.target.valueAsNumber)}
        />
        {unit && <span aria-hidden="true">{unit}</span>}
      </div>
    </div>
  )
}

export function Select<T extends string>({
  label,
  value,
  options,
  onChange,
  format = (option) => option,
}: {
  label: string
  value: T
  options: readonly T[]
  onChange: (value: T) => void
  format?: (option: T) => string
}) {
  const id = useId()
  return (
    <div className="field">
      <label className="label" htmlFor={id}>
        {label}
      </label>
      <select id={id} className="input" value={value} onChange={(e) => onChange(e.target.value as T)}>
        {options.map((option) => (
          <option key={option} value={option}>
            {format(option)}
          </option>
        ))}
      </select>
    </div>
  )
}

export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  format = (option) => option,
}: {
  label: string
  value: T
  options: readonly T[]
  onChange: (value: T) => void
  format?: (option: T) => string
}) {
  return (
    <div className="field" role="group" aria-label={label}>
      <span className="label">{label}</span>
      <div className="segmented">
        {options.map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={option === value}
            onClick={() => onChange(option)}
          >
            {format(option)}
          </button>
        ))}
      </div>
    </div>
  )
}

// Label on the left, the value on the right as a field you can type in, the
// track below. `sliderMax` is where the track ends; typing can go up to `max`.
export function Slider({
  label,
  value,
  onChange,
  min = 0,
  max,
  sliderMax = max,
  step = 1,
  unit,
  note,
}: {
  label: string
  value: number
  onChange: (value: number) => void
  min?: number
  max: number
  sliderMax?: number
  step?: number
  unit: string
  note?: ReactNode
}) {
  const id = useId()
  const fill = Number.isNaN(value) ? 0 : Math.min(1, Math.max(0, (value - min) / (sliderMax - min)))
  return (
    <div className="slider">
      <div className="slider__head">
        <label className="label" htmlFor={id}>
          {label}
          {note}
        </label>
        <span className="slider__value">
          <input
            type="number"
            inputMode="decimal"
            aria-label={`${label}, ${unit}`}
            value={shown(value)}
            min={min}
            max={max}
            step={step}
            onChange={(e) => onChange(e.target.valueAsNumber)}
          />
          {unit}
        </span>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={sliderMax}
        step={step}
        value={Number.isNaN(value) ? min : Math.min(value, sliderMax)}
        style={{ '--fill': `${fill * 100}%` } as CSSProperties}
        onChange={(e) => onChange(e.target.valueAsNumber)}
      />
    </div>
  )
}

export function Readout({
  label,
  value,
  sub,
  align = 'left',
}: {
  label: string
  value: string
  sub?: string
  align?: 'left' | 'right'
}) {
  return (
    <div className={`figure figure--${align}`}>
      <span className="readout__label">{label}</span>
      <span className="readout__value">{value}</span>
      {sub && <span className="readout__sub">{sub}</span>}
    </div>
  )
}
