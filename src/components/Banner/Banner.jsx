// The connectivity banner. Blocked and offline get different copy because
// they need different fixes: offline resolves itself and keeps retrying,
// blocked (an ad-blocker or extension) will fail forever until the person
// acts, so it stops retrying and can be dismissed.

import { useState } from 'react'
import { useAppState } from '../../context/AppContext.jsx'
import Icon from '../Icon.jsx'
import './Banner.css'

const COPY = {
  offline: 'You look offline. Specimens will load again when the connection returns.',
  blocked:
    'Something in this browser is blocking fonts.googleapis.com, so specimens cannot load. An ad blocker is the usual cause.',
}

export default function Banner() {
  const { connectivity } = useAppState()
  const [dismissed, setDismissed] = useState(false)

  if (connectivity === 'ok') return null
  if (connectivity === 'blocked' && dismissed) return null

  return (
    <div className="banner" role="status">
      <Icon name="info" size={16} />
      <span className="banner__text">{COPY[connectivity]}</span>
      {connectivity === 'blocked' && (
        <button
          type="button"
          className="banner__dismiss"
          aria-label="Dismiss this message"
          onClick={() => setDismissed(true)}
        >
          <Icon name="xmark" size={14} />
        </button>
      )}
    </div>
  )
}
