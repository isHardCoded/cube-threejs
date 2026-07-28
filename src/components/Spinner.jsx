// Soft arcade spinner used anywhere the UI is waiting. Text-only "Загрузка..."
// felt unfinished next to the hoppy buttons; a spinning ring matches the rest.
export default function Spinner({ label }) {
  return (
    <div className="spinner" role="status" aria-live="polite" aria-label={label || 'Загрузка'}>
      <i className="spinner__ring" aria-hidden="true" />
      {label ? <span className="spinner__label">{label}</span> : null}
    </div>
  )
}
