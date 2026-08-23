import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
  faAnglesLeft,
  faAnglesRight,
  faArrowRotateLeft,
  faArrowRotateRight,
  faArrowUpRightFromSquare,
  faCheck,
  faChevronDown,
  faChevronLeft,
  faChevronRight,
  faCircleInfo,
  faCopy,
  faDownload,
  faEllipsisVertical,
  faFilter,
  faKeyboard,
  faList,
  faMagnifyingGlass,
  faMinus,
  faMoon,
  faPen,
  faPlus,
  faArrowsRotate,
  faShareNodes,
  faShuffle,
  faSliders,
  faStar,
  faSun,
  faTableCellsLarge,
  faThumbtack,
  faTrash,
  faXmark,
} from '@fortawesome/free-solid-svg-icons'
import './Icon.css'

// The one place FontAwesome is touched. Components ask for a semantic name so
// swapping a glyph is a single edit here, and nothing else imports an icon.
const ICONS = {
  'angles-left': faAnglesLeft,
  'angles-right': faAnglesRight,
  'chevron-down': faChevronDown,
  'chevron-left': faChevronLeft,
  'chevron-right': faChevronRight,
  'ellipsis-vertical': faEllipsisVertical,
  check: faCheck,
  copy: faCopy,
  download: faDownload,
  external: faArrowUpRightFromSquare,
  filter: faFilter,
  grid: faTableCellsLarge,
  info: faCircleInfo,
  keyboard: faKeyboard,
  list: faList,
  minus: faMinus,
  moon: faMoon,
  pen: faPen,
  pin: faThumbtack,
  plus: faPlus,
  redo: faArrowRotateRight,
  reset: faArrowsRotate,
  search: faMagnifyingGlass,
  share: faShareNodes,
  shuffle: faShuffle,
  sliders: faSliders,
  star: faStar,
  sun: faSun,
  trash: faTrash,
  undo: faArrowRotateLeft,
  xmark: faXmark,
}

export default function Icon({ name, size = 16, className = '' }) {
  const definition = ICONS[name]
  if (!definition) return null

  return (
    <FontAwesomeIcon
      icon={definition}
      aria-hidden="true"
      className={className ? `app-icon ${className}` : 'app-icon'}
      style={{ '--icon-size': `${size}px` }}
    />
  )
}
