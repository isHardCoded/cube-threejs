import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'

const FADE_MS = 180

// Cross-fades routes. The trick is that <Routes> resolves against the router's
// current location, so keeping the old element around is not enough — the frozen
// location has to be handed back and passed to <Routes location={...}>, which
// keeps the outgoing screen on screen while it fades.
export default function PageFade({ children }) {
  const location = useLocation()
  const [shown, setShown] = useState(location)
  const [visible, setVisible] = useState(true)
  const next = useRef(location)

  useEffect(() => {
    // key is per navigation, so a plain re-render never triggers a fade
    if (location.key === shown.key) return
    next.current = location
    setVisible(false)
    const t = setTimeout(() => {
      setShown(next.current)
      setVisible(true)
    }, FADE_MS)
    return () => clearTimeout(t)
  }, [location, shown])

  return (
    <div className={`page ${visible ? 'page--in' : 'page--out'}`}>
      {children(shown)}
    </div>
  )
}
