export function AdminCheckbox({ checked, onChange, label, disabled }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      disabled={disabled}
      className={`admin-check${checked ? ' is-on' : ''}`}
      onClick={() => onChange?.(!checked)}
    >
      <span className="admin-check__box" aria-hidden="true">
        {checked ? (
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M2.5 6.2L4.8 8.5L9.5 3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        ) : null}
      </span>
      {label ? <span className="admin-check__label">{label}</span> : null}
    </button>
  )
}

export function AdminFileField({ label, file, onChange, accept = 'image/jpeg,image/png,image/webp' }) {
  const id = 'admin-file-' + (label || 'file').replace(/\s+/g, '-')
  return (
    <div className="admin-file">
      {label ? <div className="admin-field__cap">{label}</div> : null}
      <label className="admin-file__drop" htmlFor={id}>
        <input
          id={id}
          type="file"
          className="admin-file__input"
          accept={accept}
          onChange={(e) => onChange?.(e.target.files?.[0] || null)}
        />
        <span className="admin-file__btn">Выбрать файл</span>
        <span className="admin-file__name">{file ? file.name : 'Файл не выбран'}</span>
      </label>
    </div>
  )
}

export function AdminSelect({ label, value, onChange, options }) {
  return (
    <label className="admin-field">
      {label}
      <span className="admin-select">
        <select
          className="admin-select__native"
          value={value}
          onChange={(e) => onChange?.(e.target.value)}
        >
          {options.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <span className="admin-select__chev" aria-hidden="true">▾</span>
      </span>
    </label>
  )
}
