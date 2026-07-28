import { GAME_NAME } from '../config/brand.js'

// Words alternate colors, so the name stays in one place and the markup adapts
// if it ever changes.
export default function Logo({ small = false }) {
  return (
    <div className={`logo${small ? ' logo--small' : ''}`}>
      {GAME_NAME.split(' ').map((word, i) => (
        <span key={word} className={i % 2 ? 'logo__word logo__word--alt' : 'logo__word'}>
          {word}
        </span>
      ))}
    </div>
  )
}
