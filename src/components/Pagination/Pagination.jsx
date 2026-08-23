import Icon from '../Icon.jsx'
import './Pagination.css'

export default function Pagination({ page, pageCount, onSetPage }) {
  if (pageCount <= 1) return null

  return (
    <nav className="pagination" aria-label="Pages of fonts">
      <button
        type="button"
        className="pagination__button"
        aria-label="First page"
        disabled={page <= 1}
        onClick={() => onSetPage(1)}
      >
        <Icon name="angles-left" size={14} />
      </button>
      <button
        type="button"
        className="pagination__button"
        aria-label="Previous page"
        disabled={page <= 1}
        onClick={() => onSetPage(page - 1)}
      >
        <Icon name="chevron-left" size={14} />
      </button>
      <span className="pagination__label">
        Page {page} of {pageCount}
      </span>
      <button
        type="button"
        className="pagination__button"
        aria-label="Next page"
        disabled={page >= pageCount}
        onClick={() => onSetPage(page + 1)}
      >
        <Icon name="chevron-right" size={14} />
      </button>
      <button
        type="button"
        className="pagination__button"
        aria-label="Last page"
        disabled={page >= pageCount}
        onClick={() => onSetPage(pageCount)}
      >
        <Icon name="angles-right" size={14} />
      </button>
    </nav>
  )
}
