import { useLocale } from '../i18n/LocaleContext.jsx'

const SRC = '/assets/ui/cubes.png'

/** Currency mark — green cube stack asset instead of the “cubes” word. */
export default function CubesMark({ size = 28, className = '' }) {
  const { t } = useLocale()
  return (
    <img
      className={`cubes-mark ${className}`.trim()}
      src={SRC}
      alt={t('menu.cubes')}
      width={size}
      height={size}
      draggable={false}
      style={{ width: size, height: size }}
    />
  )
}
