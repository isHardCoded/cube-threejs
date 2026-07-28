// Door-with-arrow: reads as "leave" without a word, which is what phones need
// when the who-row is already tight.
export default function LogoutIcon({ size = 18 }) {
  return (
    <svg
      className="icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M10 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4" />
      <path d="M14 12H22" />
      <path d="M18 8l4 4-4 4" />
    </svg>
  )
}
