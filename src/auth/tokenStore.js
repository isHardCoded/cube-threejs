// Kept apart from the API client and the auth context so neither has to
// import the other.
const TOKEN_KEY = 'cube-game-token'

export const getToken = () => localStorage.getItem(TOKEN_KEY) || ''

export function setToken(token) {
  if (token) localStorage.setItem(TOKEN_KEY, token)
  else localStorage.removeItem(TOKEN_KEY)
}
